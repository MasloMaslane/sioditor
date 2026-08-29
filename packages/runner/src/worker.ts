/// <reference lib="webworker" />
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from '@bjorn3/browser_wasi_shim';
import type { ExecuteRequest, RunnerMessage, RunnerRequest } from './protocol.js';
import type { RunOutcomeKind, RunResult } from './types.js';

const PAGE_BYTES = 64 * 1024;

const encoder = new TextEncoder();

function collect(into: string[]): ConsoleStdout {
  return new ConsoleStdout((bytes) => {
    into.push(new TextDecoder().decode(bytes));
  });
}

/**
 * Runs one program to completion inside this worker.
 *
 * The worker is disposable by design: the parent terminates it to enforce the time limit,
 * which is the only mechanism that reliably stops code WebAssembly will not yield from.
 * So there is no need to guard against a second execute in the same worker.
 */
async function execute(request: ExecuteRequest): Promise<RunResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const stdinBytes = encoder.encode(request.stdin);
  const wasi = new WASI(
    [...request.argv],
    [],
    [
      new OpenFile(new File(stdinBytes)),
      collect(stdoutChunks),
      collect(stderrChunks),
      new PreopenDirectory('/', new Map()),
    ],
    { debug: false },
  );

  // A ceiling rather than a budget: growth past `maximum` fails inside the module, which
  // surfaces as a failed allocation or a trap - exactly what we want to report as
  // out-of-memory instead of letting the tab balloon.
  const maximumPages = Math.max(1, Math.floor(request.limits.memoryLimitBytes / PAGE_BYTES));
  const memory = new WebAssembly.Memory({ initial: 256, maximum: maximumPages });

  const startedAt = performance.now();
  let peakMemoryBytes = memory.buffer.byteLength;
  const sampler = setInterval(() => {
    peakMemoryBytes = Math.max(peakMemoryBytes, memory.buffer.byteLength);
  }, 10);

  const finish = (outcome: RunOutcomeKind, extra: Partial<RunResult> = {}): RunResult => {
    clearInterval(sampler);
    peakMemoryBytes = Math.max(peakMemoryBytes, memory.buffer.byteLength);
    return {
      outcome,
      stdout: stdoutChunks.join(''),
      stderr: stderrChunks.join(''),
      durationMs: Math.round(performance.now() - startedAt),
      peakMemoryBytes,
      ...extra,
    };
  };

  try {
    const module = await WebAssembly.compile(request.moduleBytes);
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
      env: { memory },
    });
    wasi.start(
      instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => void } },
    );
    return finish('finished', { exitCode: 0 });
  } catch (cause) {
    // browser_wasi_shim throws a WASIProcExit carrying the status for a normal exit(),
    // so a non-zero code arrives here rather than as a return value.
    const exitCode = (cause as { code?: number } | undefined)?.code;
    if (typeof exitCode === 'number') {
      return exitCode === 0
        ? finish('finished', { exitCode })
        : finish('crashed', { exitCode, detail: `program zakonczyl sie kodem ${exitCode}` });
    }

    const message = cause instanceof Error ? cause.message : String(cause);
    // Growth refused at `maximum` reads as an allocation failure rather than a distinct
    // error type, so the message is the only signal available to tell the two apart.
    if (/memory|allocation|grow/i.test(message)) {
      return finish('out-of-memory', { detail: message });
    }
    return finish('crashed', { detail: message });
  }
}

self.onmessage = (event: MessageEvent<RunnerRequest>) => {
  void execute(event.data).then((result) => {
    const message: RunnerMessage = { kind: 'result', result };
    self.postMessage(message);
  });
};
