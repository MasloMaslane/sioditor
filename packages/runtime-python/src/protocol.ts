/** Messages between the main thread and the Pyodide worker. */

export interface RunRequest {
  readonly kind: 'run';
  readonly runId: string;
  readonly source: string;
  /** Fed to the program as stdin. Empty string means "no input". */
  readonly stdin: string;
  /** Wall-clock cap in milliseconds. The client, not the worker, enforces it. */
  readonly timeLimitMs: number;
  /**
   * Shared buffer for interactive input, when the page is offering it. Absent means
   * input() sees end-of-input once `stdin` is spent.
   */
  readonly stdinChannel?: SharedArrayBuffer;
}

export interface InitRequest {
  readonly kind: 'init';
  /** Same-origin directory holding the self-hosted Pyodide files. */
  readonly indexUrl: string;
  /** Shared with the worker so a stop request can raise KeyboardInterrupt. */
  readonly interruptBuffer?: Uint8Array;
}

export type WorkerRequest = InitRequest | RunRequest;

export interface ReadyMessage {
  readonly kind: 'ready';
  readonly pythonVersion: string;
}

export interface OutputMessage {
  readonly kind: 'output';
  readonly runId: string;
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

/** The program is blocked on input() and the page should prompt. */
export interface NeedsInputMessage {
  readonly kind: 'needs-input';
  readonly runId: string;
}

export interface DoneMessage {
  readonly kind: 'done';
  readonly runId: string;
  /** Present when the program raised; already formatted as a Python traceback. */
  readonly error?: string;
  readonly interrupted: boolean;
}

export interface FailedMessage {
  readonly kind: 'failed';
  readonly error: string;
}

export type WorkerMessage =
  ReadyMessage | OutputMessage | NeedsInputMessage | DoneMessage | FailedMessage;
