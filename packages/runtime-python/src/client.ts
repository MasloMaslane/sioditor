import type { DoneMessage, WorkerMessage, WorkerRequest } from './protocol.js';

export interface RunOutput {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

export type RunOutcome =
  | { readonly kind: 'finished'; readonly durationMs: number }
  | { readonly kind: 'error'; readonly message: string; readonly durationMs: number }
  | { readonly kind: 'timeout'; readonly durationMs: number }
  | { readonly kind: 'stopped'; readonly durationMs: number };

export interface RunOptions {
  readonly source: string;
  readonly stdin?: string;
  readonly timeLimitMs?: number;
  readonly onOutput?: (output: RunOutput) => void;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIME_LIMIT_MS = 10_000;

/**
 * Owns the Pyodide worker and its lifecycle.
 *
 * Interrupting is tried first because it keeps the interpreter alive and gives the user a
 * real traceback. Terminating is the guarantee: it is the only thing that reliably stops
 * code WebAssembly will not yield from, at the cost of a fresh interpreter boot.
 */
export class PythonRuntime {
  private worker: Worker | undefined;
  private readyPromise: Promise<string> | undefined;
  private interruptBuffer: Uint8Array | undefined;
  private nextRunId = 0;

  constructor(private readonly indexUrl: string) {}

  /** Resolves with the CPython version once the interpreter has booted. */
  async ready(): Promise<string> {
    this.readyPromise ??= this.boot();
    return this.readyPromise;
  }

  private boot(): Promise<string> {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker = worker;

    // Only available when the document is cross-origin isolated. Our own server sets
    // COOP/COEP so it should always be, but a misconfigured proxy must degrade rather
    // than crash - terminate() still stops runaway code either way.
    if (typeof SharedArrayBuffer === 'function' && self.crossOriginIsolated) {
      this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
    }

    return new Promise<string>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.kind === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve(message.pythonVersion);
        } else if (message.kind === 'failed') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.error));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (event) => reject(new Error(event.message)));

      const request: WorkerRequest = {
        kind: 'init',
        indexUrl: this.indexUrl,
        ...(this.interruptBuffer ? { interruptBuffer: this.interruptBuffer } : {}),
      };
      worker.postMessage(request);
    });
  }

  async run(options: RunOptions): Promise<RunOutcome> {
    await this.ready();
    const worker = this.worker;
    if (!worker) throw new Error('python runtime not started');

    const runId = String(this.nextRunId++);
    const timeLimitMs = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    return new Promise<RunOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      };

      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.kind === 'output' && message.runId === runId) {
          options.onOutput?.({ stream: message.stream, text: message.text });
        } else if (message.kind === 'done' && message.runId === runId) {
          finish(this.outcomeFor(message, elapsed()));
        } else if (message.kind === 'failed') {
          finish({ kind: 'error', message: message.error, durationMs: elapsed() });
        }
      };
      worker.addEventListener('message', onMessage);

      const stop = (outcome: RunOutcome) => {
        // Interrupt first for a clean traceback; hard-kill so the UI always comes back.
        this.signalInterrupt();
        this.restart();
        finish(outcome);
      };

      const timer = setTimeout(() => stop({ kind: 'timeout', durationMs: elapsed() }), timeLimitMs);
      const onAbort = () => stop({ kind: 'stopped', durationMs: elapsed() });
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const request: WorkerRequest = {
        kind: 'run',
        runId,
        source: options.source,
        stdin: options.stdin ?? '',
        timeLimitMs,
      };
      worker.postMessage(request);
    });
  }

  private outcomeFor(message: DoneMessage, durationMs: number): RunOutcome {
    if (message.interrupted) return { kind: 'stopped', durationMs };
    if (message.error) return { kind: 'error', message: message.error, durationMs };
    return { kind: 'finished', durationMs };
  }

  /** Writes SIGINT into the shared buffer; a no-op when we never got one. */
  private signalInterrupt(): void {
    if (this.interruptBuffer) this.interruptBuffer[0] = 2;
  }

  /** Discards the interpreter. The next run pays a boot, which beats a wedged tab. */
  restart(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.readyPromise = undefined;
    this.interruptBuffer = undefined;
  }
}
