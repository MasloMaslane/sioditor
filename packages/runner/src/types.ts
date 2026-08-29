/** What a single execution of a compiled program produced. */
export interface RunResult {
  readonly outcome: RunOutcomeKind;
  readonly stdout: string;
  readonly stderr: string;
  /** Wall-clock milliseconds, measured around the wasm call. */
  readonly durationMs: number;
  /**
   * Peak linear memory in bytes, sampled from the module's own exported memory every
   * 10 ms. A close approximation: a spike between samples is missed, and a program that
   * finishes in under 10 ms reports only its final size.
   */
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
  | 'finished'
  | 'crashed'
  /**
   * Recursion deeper than the engine's own call stack allows. Its own outcome rather than
   * a kind of crash, because the browser's limit is thousands of frames where a judge
   * allows millions - so it needs explaining, not just reporting.
   */
  | 'stack-overflow'
  | 'timed-out'
  | 'out-of-memory'
  | 'stopped'
  | 'internal-error';

export interface RunLimits {
  /** Wall-clock cap. Exceeding it terminates the worker. */
  readonly timeLimitMs: number;
  /**
   * Ceiling on linear memory. Applied at link time via --max-memory, not here: a wasi
   * module declares and exports its own memory, so a runtime cannot impose one on it.
   */
  readonly memoryLimitBytes: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  timeLimitMs: 5_000,
  memoryLimitBytes: 256 * 1024 * 1024,
};
