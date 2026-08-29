import type { Diagnostic } from './diagnostics.js';
import type { PortabilityNote } from './portability.js';

export interface BuildRequest {
  readonly kind: 'build';
  readonly buildId: string;
  readonly source: string;
  readonly memoryLimitBytes: number;
}

export interface InitRequest {
  readonly kind: 'init';
  /** Same-origin directory holding clang.wasm, lld.wasm and sysroot.bin. */
  readonly baseUrl: string;
}

export type CompilerRequest = InitRequest | BuildRequest;

export interface ReadyMessage {
  readonly kind: 'ready';
  readonly clangVersion: string;
  readonly sysrootFiles: number;
}

/** Emitted as each phase starts, so the UI can say what is happening during a slow build. */
export interface ProgressMessage {
  readonly kind: 'progress';
  readonly buildId: string;
  readonly phase: 'compiling' | 'linking';
}

export interface BuiltMessage {
  readonly kind: 'built';
  readonly buildId: string;
  readonly ok: boolean;
  /** The linked program, present only when ok. */
  readonly moduleBytes?: Uint8Array<ArrayBuffer>;
  readonly diagnostics: readonly Diagnostic[];
  readonly notes: readonly PortabilityNote[];
  /** Anything the tools wrote that was not a parseable diagnostic. */
  readonly rawOutput: string;
  readonly compileMs: number;
  readonly linkMs: number;
}

export interface FailedMessage {
  readonly kind: 'failed';
  readonly error: string;
}

export type CompilerMessage = ReadyMessage | ProgressMessage | BuiltMessage | FailedMessage;
