import type { CompilerMessage, CompilerRequest } from './protocol.js';
import type { Diagnostic } from './diagnostics.js';
import type { PortabilityNote } from './portability.js';

export interface BuildResult {
  readonly ok: boolean;
  readonly moduleBytes?: Uint8Array<ArrayBuffer>;
  readonly diagnostics: readonly Diagnostic[];
  readonly notes: readonly PortabilityNote[];
  readonly rawOutput: string;
  readonly compileMs: number;
  readonly linkMs: number;
}

export interface BuildOptions {
  readonly source: string;
  readonly memoryLimitBytes?: number;
  readonly onPhase?: (phase: 'compiling' | 'linking') => void;
}

const DEFAULT_MEMORY_LIMIT = 256 * 1024 * 1024;

/**
 * Owns the compiler worker.
 *
 * Kept alive across builds, unlike the run worker: loading clang and lld costs a fetch and
 * a wasm compile of ninety megabytes, so throwing it away per build would be absurd. It is
 * also safe to keep - each tool gets a fresh WebAssembly.Instance per invocation, because
 * both call exit() and leave their memory unusable.
 */
export class CppToolchain {
  private worker: Worker | undefined;
  private readyPromise: Promise<{ clangVersion: string; sysrootFiles: number }> | undefined;
  private nextBuildId = 0;

  constructor(private readonly baseUrl: string) {}

  ready(): Promise<{ clangVersion: string; sysrootFiles: number }> {
    this.readyPromise ??= this.boot();
    return this.readyPromise;
  }

  private boot(): Promise<{ clangVersion: string; sysrootFiles: number }> {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker = worker;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<CompilerMessage>) => {
        const message = event.data;
        if (message.kind === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve({ clangVersion: message.clangVersion, sysrootFiles: message.sysrootFiles });
        } else if (message.kind === 'failed') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.error));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (event) => {
        reject(new Error(`compiler worker failed to start: ${event.message || 'unknown'}`));
      });

      const request: CompilerRequest = { kind: 'init', baseUrl: this.baseUrl };
      worker.postMessage(request);
    });
  }

  async build(options: BuildOptions): Promise<BuildResult> {
    await this.ready();
    const worker = this.worker;
    if (!worker) throw new Error('toolchain not started');

    const buildId = String(this.nextBuildId++);

    return new Promise<BuildResult>((resolve, reject) => {
      const onMessage = (event: MessageEvent<CompilerMessage>) => {
        const message = event.data;
        if (message.kind === 'progress' && message.buildId === buildId) {
          options.onPhase?.(message.phase);
        } else if (message.kind === 'built' && message.buildId === buildId) {
          worker.removeEventListener('message', onMessage);
          resolve(message);
        } else if (message.kind === 'failed') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(message.error));
        }
      };
      worker.addEventListener('message', onMessage);

      const request: CompilerRequest = {
        kind: 'build',
        buildId,
        source: options.source,
        memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT,
      };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.readyPromise = undefined;
  }
}
