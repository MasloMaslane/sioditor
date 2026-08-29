import type { RunLimits, RunResult } from './types.js';

export interface ExecuteRequest {
  readonly kind: 'execute';
  /**
   * A linked wasm32-wasip1 module. Pinned to a non-shared ArrayBuffer: WebAssembly.compile
   * will not take a SharedArrayBuffer view, and this file is compiled in a
   * cross-origin-isolated context where that is a real possibility.
   */
  readonly moduleBytes: Uint8Array<ArrayBuffer>;
  readonly stdin: string;
  readonly argv: readonly string[];
  readonly limits: RunLimits;
  /**
   * Shared buffer for interactive input, when the page is offering it. Absent means the
   * program sees end-of-input once `stdin` is exhausted, which is what a test case wants.
   */
  readonly stdinChannel?: SharedArrayBuffer;
}

/** The program is blocked reading stdin and the page should prompt for a line. */
export interface NeedsInputMessage {
  readonly kind: 'needs-input';
}

export interface ResultMessage {
  readonly kind: 'result';
  readonly result: RunResult;
}

export type RunnerRequest = ExecuteRequest;
export type RunnerMessage = ResultMessage | NeedsInputMessage;
