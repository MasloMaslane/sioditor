/// <reference lib="webworker" />
import type { WorkerRequest, WorkerMessage, RunRequest } from './protocol.js';
import { requiredPyodidePackages } from './imports.js';
import { attachStdinChannel, readStdinBlocking } from '@sioditor/runner';

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
  let loader: { loadPyodide(options: { indexURL: string }): Promise<PyodideApi> };
  try {
    loader = (await import(/* @vite-ignore */ `${indexUrl}/pyodide.mjs`)) as typeof loader;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not load ${indexUrl}/pyodide.mjs (offline cache miss?): ${detail}`);
  }
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

  // Pyodide's `batched` callback fires once per line, with the newline stripped. Joining
  // the chunks as-is therefore runs every line together: a program printing 1, 9 and 3 on
  // separate lines produced "193", and comparing that against expected output is
  // meaningless. Put the newline back.
  const emit = (stream: 'stdout' | 'stderr') => ({
    batched: (text: string) => post({ kind: 'output', runId, stream, text: `${text}\n` }),
  });
  pyodide.setStdout(emit('stdout'));
  pyodide.setStderr(emit('stderr'));

  // Pyodide asks for one line at a time and treats null as EOF. Splitting up front keeps
  // input() behaving the way a program reading a test case expects; once those run out we
  // block on the shared channel if the page offered one, so input() can be answered live.
  const lines = stdin.length > 0 ? stdin.split('\n') : [];
  let cursor = 0;
  const channel = request.stdinChannel ? attachStdinChannel(request.stdinChannel) : undefined;
  const decoder = new TextDecoder();

  pyodide.setStdin({
    stdin: () => {
      if (cursor < lines.length) return `${lines[cursor++]}\n`;
      if (!channel) return null;
      const bytes = readStdinBlocking(channel, () => post({ kind: 'needs-input', runId }));
      return bytes.byteLength > 0 ? decoder.decode(bytes) : null;
    },
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
