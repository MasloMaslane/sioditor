/** What a single execution of a compiled program produced. */
export interface RunResult {
  readonly outcome: RunOutcomeKind;
  readonly stdout: string;
  readonly stderr: string;
  /** Wall-clock milliseconds, measured around the wasm call. */
  readonly durationMs: number;
  /** Peak linear memory in bytes. Sampled, so treat it as a close approximation. */
  readonly peakMemoryBytes: number;
  /** Set when the program exited non-zero or trapped. */
  readonly exitCode?: number;
  /** Set when something went wrong outside the program itself. */
  readonly detail?: string;
}

/**
 * Deliberately descriptive rather than judge-style. This tool reports what happened;
 * it does not hand out verdicts, because wasm timings do not match the judge's hardware
 * and pretending otherwise would mislead.
 */
export type RunOutcomeKind =
  'finished' | 'crashed' | 'timed-out' | 'out-of-memory' | 'stopped' | 'internal-error';

export interface RunLimits {
  /** Wall-clock cap. Exceeding it terminates the worker. */
  readonly timeLimitMs: number;
  /** Hard ceiling on linear memory; the module cannot grow past it. */
  readonly memoryLimitBytes: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  timeLimitMs: 5_000,
  memoryLimitBytes: 256 * 1024 * 1024,
};
