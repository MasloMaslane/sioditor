/// <reference lib="webworker" />
import {
  WASI,
  File,
  OpenFile,
  Directory,
  ConsoleStdout,
  PreopenDirectory,
} from '@bjorn3/browser_wasi_shim';
import { parseSysroot } from './sysroot.js';
import { compileArgs, linkArgs } from './flags.js';
import { parseDiagnostics, hasErrors } from './diagnostics.js';
import { checkPortability } from './portability.js';
import type { BuildRequest, CompilerMessage, CompilerRequest } from './protocol.js';

const post = (message: CompilerMessage) => self.postMessage(message);

let clangModule: WebAssembly.Module | undefined;
let lldModule: WebAssembly.Module | undefined;
let sysrootRoot: Directory | undefined;

/**
 * Fetches and compiles a tool.
 *
 * compileStreaming rather than fetch-then-compile: it is the only path that populates the
 * browser's wasm code cache, which is what turns a multi-second TurboFan tier-up into
 * nothing on the second visit. The URL has to stay stable for that cache to hit.
 */
async function loadModule(url: string): Promise<WebAssembly.Module> {
  return WebAssembly.compileStreaming(fetch(url));
}

/** A fresh instance per run: these tools call exit() and leave their memory unusable. */
async function run(
  module: WebAssembly.Module,
  args: readonly string[],
  work: Directory,
  onOutput: (text: string) => void,
): Promise<number> {
  if (!sysrootRoot) throw new Error('sysroot not loaded');

  const collect = () => new ConsoleStdout((bytes) => onOutput(new TextDecoder().decode(bytes)));

  const wasi = new WASI(
    [...args],
    ['TMPDIR=/work/tmp'],
    [
      new OpenFile(new File(new Uint8Array())),
      collect(),
      collect(),
      new PreopenDirectory('/sysroot', sysrootRoot.contents),
      new PreopenDirectory('/work', work.contents),
    ],
    { debug: false },
  );

  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  try {
    wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start(): void } });
    return 0;
  } catch (cause) {
    // browser_wasi_shim signals a normal exit() by throwing, carrying the status.
    const code = (cause as { code?: number } | undefined)?.code;
    if (typeof code === 'number') return code;
    throw cause;
  }
}

async function init(baseUrl: string): Promise<void> {
  const [clang, lld, sysrootResponse] = await Promise.all([
    loadModule(`${baseUrl}/clang.wasm`),
    loadModule(`${baseUrl}/lld.wasm`),
    fetch(`${baseUrl}/sysroot.bin`),
  ]);
  if (!sysrootResponse.ok) {
    throw new Error(`sysroot.bin returned ${sysrootResponse.status}`);
  }

  clangModule = clang;
  lldModule = lld;
  const image = new Uint8Array(await sysrootResponse.arrayBuffer());
  const parsed = parseSysroot(image);
  sysrootRoot = parsed.root;

  let version = '';
  const versionWork = new Directory(new Map());
  await run(clang, ['clang', '--version'], versionWork, (text) => {
    version += text;
  });

  post({
    kind: 'ready',
    clangVersion: version.split('\n')[0]?.trim() ?? 'clang',
    sysrootFiles: parsed.fileCount,
  });
}

async function build(request: BuildRequest): Promise<void> {
  if (!clangModule || !lldModule) throw new Error('compiler used before init');
  const { buildId, source } = request;

  // A writable scratch directory. Only main.cpp exists to begin with; clang writes the
  // object here and lld reads it back, which is why both tools share one directory.
  const work = new Directory(new Map());
  work.contents.set('main.cpp', new File(new TextEncoder().encode(source)));
  work.contents.set('tmp', new Directory(new Map()));

  let output = '';
  const collect = (text: string) => {
    output += text;
  };

  post({ kind: 'progress', buildId, phase: 'compiling' });
  const compileStart = performance.now();
  const compileStatus = await run(
    clangModule,
    ['clang', ...compileArgs('/work/main.cpp', '/work/main.o')],
    work,
    collect,
  );
  const compileMs = Math.round(performance.now() - compileStart);

  const notes = checkPortability(source);
  const finish = (ok: boolean, moduleBytes?: Uint8Array<ArrayBuffer>, linkMs = 0) => {
    post({
      kind: 'built',
      buildId,
      ok,
      ...(moduleBytes ? { moduleBytes } : {}),
      diagnostics: parseDiagnostics(output),
      notes,
      rawOutput: output,
      compileMs,
      linkMs,
    });
  };

  if (compileStatus !== 0 || !work.contents.has('main.o')) {
    finish(false);
    return;
  }

  post({ kind: 'progress', buildId, phase: 'linking' });
  const linkStart = performance.now();
  const linkStatus = await run(
    lldModule,
    [
      'wasm-ld',
      ...linkArgs('/work/main.o', '/work/main.wasm', {
        memoryLimitBytes: request.memoryLimitBytes,
      }),
    ],
    work,
    collect,
  );
  const linkMs = Math.round(performance.now() - linkStart);

  const produced = work.contents.get('main.wasm');
  if (linkStatus !== 0 || !(produced instanceof File)) {
    finish(false, undefined, linkMs);
    return;
  }

  // Copied out of the VFS so it can be transferred to the runner without keeping the
  // whole sysroot buffer alive alongside it.
  const bytes = new Uint8Array(produced.data.byteLength);
  bytes.set(produced.data);
  finish(true, bytes, linkMs);
}

self.onmessage = (event: MessageEvent<CompilerRequest>) => {
  const request = event.data;
  const handler = request.kind === 'init' ? init(request.baseUrl) : build(request);
  handler.catch((cause: unknown) => {
    post({ kind: 'failed', error: cause instanceof Error ? cause.message : String(cause) });
  });
};
