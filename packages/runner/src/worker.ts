/// <reference lib="webworker" />
import {
  WASI,
  File,
  OpenFile,
  ConsoleStdout,
  PreopenDirectory,
  Fd,
} from '@bjorn3/browser_wasi_shim';
import { attachStdinChannel, readStdinBlocking } from './stdin-channel.js';
import type { ExecuteRequest, RunnerMessage, RunnerRequest } from './protocol.js';
import type { RunOutcomeKind, RunResult } from './types.js';
import { classifyTrap } from './traps.js';

const encoder = new TextEncoder();

/**
 * stdin that serves the test case first and then asks the page for more.
 *
 * browser_wasi_shim's OpenFile reads from a fixed buffer and reports end-of-input once it
 * is spent, which is right for a test case but leaves an interactive program seeing EOF
 * the moment it asks a question. This descriptor blocks on the shared channel instead,
 * which is possible only because the worker is free to stop and the page is not.
 */
class InteractiveStdin extends Fd {
  private offset = 0;

  constructor(
    private preloaded: Uint8Array,
    private readonly channel: SharedArrayBuffer | undefined,
    private readonly onWait: () => void,
  ) {
    super();
  }

  override fd_read(size: number): { ret: number; data: Uint8Array } {
    if (this.offset >= this.preloaded.byteLength && this.channel) {
      const more = readStdinBlocking(attachStdinChannel(this.channel), this.onWait);
      if (more.byteLength > 0) {
        // Keep whatever is unread rather than replacing, so a partial read is not lost.
        const remaining = this.preloaded.subarray(this.offset);
        const merged = new Uint8Array(remaining.byteLength + more.byteLength);
        merged.set(remaining);
        merged.set(more, remaining.byteLength);
        this.preloaded = merged;
        this.offset = 0;
      }
    }

    const chunk = this.preloaded.subarray(this.offset, this.offset + size);
    this.offset += chunk.byteLength;
    return { ret: 0, data: chunk };
  }
}

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
      new InteractiveStdin(stdinBytes, request.stdinChannel, () =>
        self.postMessage({ kind: 'needs-input' } satisfies RunnerMessage),
      ),
      collect(stdoutChunks),
      collect(stderrChunks),
      new PreopenDirectory('/', new Map()),
    ],
    { debug: false },
  );

  // The memory a wasi program uses is one it declares and exports itself; it does not
  // import one. An earlier version of this file created a WebAssembly.Memory here and
  // passed it as env.memory, which the module simply ignored - so every run reported the
  // same 16 MB, and the cap was never enforced at all.
  //
  // The real cap is set at link time by --max-memory (see toolchain-cpp/flags.ts), which
  // is baked into the module's memory declaration and enforced by the engine. This
  // function's job is to measure, not to limit.
  let instanceMemory: WebAssembly.Memory | undefined;

  const startedAt = performance.now();
  let peakMemoryBytes = 0;
  const sample = () => {
    if (instanceMemory) {
      peakMemoryBytes = Math.max(peakMemoryBytes, instanceMemory.buffer.byteLength);
    }
  };
  const sampler = setInterval(sample, 10);

  const finish = (outcome: RunOutcomeKind, extra: Partial<RunResult> = {}): RunResult => {
    clearInterval(sampler);
    sample();
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
    });

    const exported = (instance.exports as { memory?: WebAssembly.Memory }).memory;
    if (exported instanceof WebAssembly.Memory) instanceMemory = exported;

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
    return finish(classifyTrap(message), { detail: message });
  }
}

self.onmessage = (event: MessageEvent<RunnerRequest>) => {
  void execute(event.data).then((result) => {
    const message: RunnerMessage = { kind: 'result', result };
    self.postMessage(message);
  });
};
