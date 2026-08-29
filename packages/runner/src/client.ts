import type { RunnerMessage, RunnerRequest } from './protocol.js';
import { DEFAULT_LIMITS, type RunLimits, type RunResult } from './types.js';

export interface ExecuteOptions {
  /**
   * Shared buffer for interactive input. When absent the program sees end-of-input once
   * `stdin` is spent, which is what running a test case wants.
   */
  readonly stdinChannel?: SharedArrayBuffer;
  /** Called when the program blocks waiting for a line the page has not supplied yet. */
  readonly onNeedsInput?: () => void;
  readonly moduleBytes: Uint8Array<ArrayBuffer>;
  readonly stdin?: string;
  readonly argv?: readonly string[];
  readonly limits?: Partial<RunLimits>;
  readonly signal?: AbortSignal;
}

/**
 * Runs a compiled program in a throwaway worker.
 *
 * One worker per execution, always discarded afterwards. That is what makes the time
 * limit an actual guarantee rather than a request: terminate() stops a tight loop that
 * no cooperative mechanism can interrupt, and a fresh worker gives clean memory numbers
 * for the next run.
 */
export async function execute(options: ExecuteOptions): Promise<RunResult> {
  const limits: RunLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  const empty = (outcome: RunResult['outcome']): RunResult => ({
    outcome,
    stdout: '',
    stderr: '',
    durationMs: elapsed(),
    peakMemoryBytes: 0,
  });

  try {
    return await new Promise<RunResult>((resolve) => {
      const timer = setTimeout(() => resolve(empty('timed-out')), limits.timeLimitMs);
      const onAbort = () => resolve(empty('stopped'));

      worker.onmessage = (event: MessageEvent<RunnerMessage>) => {
        if (event.data.kind === 'needs-input') {
          // Not a result: the program is blocked and the page has to prompt. The time
          // limit keeps running, which is right - a program waiting on input it will
          // never get should still be stopped.
          options.onNeedsInput?.();
          return;
        }
        clearTimeout(timer);
        resolve(event.data.result);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        resolve({ ...empty('internal-error'), detail: event.message });
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const request: RunnerRequest = {
        kind: 'execute',
        moduleBytes: options.moduleBytes,
        stdin: options.stdin ?? '',
        argv: options.argv ?? ['program'],
        limits,
        ...(options.stdinChannel ? { stdinChannel: options.stdinChannel } : {}),
      };
      worker.postMessage(request);
    });
  } finally {
    worker.terminate();
  }
}
