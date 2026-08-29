/// <reference lib="webworker" />
import type { WorkerRequest, WorkerMessage, RunRequest } from './protocol.js';
import { requiredPyodidePackages } from './imports.js';

// Pyodide's own types are only available once the module is loaded from our origin,
// so the surface we use is described locally rather than pulled in as a build dep.
interface PyodideApi {
  version: string;
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
  setStdin(options: { stdin: () => string | null }): void;
  setInterruptBuffer(buffer: Uint8Array): void;
  loadPackage(names: string[]): Promise<void>;
}

let pyodide: PyodideApi | undefined;

const post = (message: WorkerMessage) => self.postMessage(message);

async function init(indexUrl: string, interruptBuffer?: Uint8Array): Promise<void> {
  // Loaded from our own origin: COEP would block jsDelivr, and offline must work anyway.
  const loader = (await import(/* @vite-ignore */ `${indexUrl}/pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<PyodideApi>;
  };
  pyodide = await loader.loadPyodide({ indexURL: `${indexUrl}/` });

  if (interruptBuffer) {
    // Lets the main thread raise KeyboardInterrupt inside a running program without
    // destroying the interpreter. Requires cross-origin isolation, which our server
    // guarantees; worker.terminate() remains the backstop for code this cannot reach.
    pyodide.setInterruptBuffer(interruptBuffer);
  }

  post({ kind: 'ready', pythonVersion: pyodide.version });
}

async function run(request: RunRequest): Promise<void> {
  if (!pyodide) throw new Error('python worker used before init');
  const { runId, source, stdin } = request;

  pyodide.setStdout({ batched: (text) => post({ kind: 'output', runId, stream: 'stdout', text }) });
  pyodide.setStderr({ batched: (text) => post({ kind: 'output', runId, stream: 'stderr', text }) });

  // Pyodide asks for one line at a time and treats null as EOF. Splitting up front keeps
  // input() behaving the way a program reading a test case expects.
  const lines = stdin.length > 0 ? stdin.split('\n') : [];
  let cursor = 0;
  pyodide.setStdin({
    stdin: () => (cursor < lines.length ? `${lines[cursor++]}\n` : null),
  });

  const packages = requiredPyodidePackages(source);
  if (packages.length > 0) {
    await pyodide.loadPackage(packages);
  }

  try {
    await pyodide.runPythonAsync(source);
    post({ kind: 'done', runId, interrupted: false });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const interrupted = message.includes('KeyboardInterrupt');
    post({
      kind: 'done',
      runId,
      interrupted,
      ...(interrupted ? {} : { error: message }),
    });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const handler =
    request.kind === 'init' ? init(request.indexUrl, request.interruptBuffer) : run(request);

  handler.catch((cause: unknown) => {
    post({ kind: 'failed', error: cause instanceof Error ? cause.message : String(cause) });
  });
};
