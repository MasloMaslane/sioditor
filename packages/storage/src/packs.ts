/**
 * An asset pack is a versioned group of large files fetched once and then kept in OPFS.
 *
 * Everything here must be same-origin. Under `Cross-Origin-Embedder-Policy: require-corp`
 * a cross-origin subresource is blocked unless it carries `Cross-Origin-Resource-Policy`,
 * which we cannot set on GitHub Releases or jsDelivr. So the clang and Pyodide payloads
 * are built in CI and deployed alongside the app rather than pulled from a CDN.
 */
export interface AssetPackFile {
  /** Path within the pack, also the OPFS filename. */
  readonly name: string;
  /** Uncompressed size in bytes, used for progress before any byte arrives. */
  readonly bytes: number;
}

/**
 * Where a pack's bytes live once fetched.
 *
 * `cache` is what every pack currently uses, because everything that consumes them does
 * so by URL: Pyodide's loader resolves its own siblings, and the compiler worker uses
 * WebAssembly.compileStreaming, which needs a real response to stream. Only Cache Storage
 * is replayed by the service worker, so only Cache Storage survives going offline.
 *
 * `opfs` remains for a consumer that reads bytes itself and would benefit from random
 * access without the structured-clone tax. Nothing does yet; putting a pack there today
 * makes it invisible to the code that needs it.
 */
export type PackStorage = 'opfs' | 'cache';

export interface AssetPack {
  readonly id: string;
  readonly label: string;
  readonly storage: PackStorage;
  /**
   * Bumping this changes every URL, which is what lets the server mark the old ones
   * `immutable`. It also invalidates the OPFS copy.
   */
  readonly version: string;
  /** Same-origin directory the files are served from, without a trailing slash. */
  readonly baseUrl: string;
  readonly files: readonly AssetPackFile[];
  /** Shown in the storage panel so the size is never a surprise. */
  readonly description: string;
  /** Required packs are fetched on first install; optional ones are opt-in. */
  readonly optional: boolean;
}

export type PackState = 'absent' | 'downloading' | 'ready' | 'failed';

export interface PackProgress {
  readonly packId: string;
  readonly state: PackState;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly currentFile?: string;
  readonly error?: string;
}

/**
 * Sizes are uncompressed bytes on disk, all measured from the real artifacts - Python and
 * NumPy from `scripts/vendor-pyodide.mjs`, C++ from the toolchain build. The downloader
 * still prefers the Content-Length it actually sees over anything written here.
 *
 * The C++ pack is large uncompressed but compresses hard: about 22 MB over the wire with
 * brotli, which the server config serves precompressed.
 */
export const PACKS: readonly AssetPack[] = [
  {
    id: 'cpp',
    label: 'C++ (clang)',
    // Cache Storage, not OPFS, and this is not a detail. The compiler worker loads
    // clang.wasm with compileStreaming and fetches the sysroot by URL, and only Cache
    // Storage is replayed by the service worker - a pack sitting in OPFS is invisible to
    // a fetch, so C++ failed with "Failed to fetch" the moment the network went away.
    // OPFS was chosen for random access into the sysroot, which never materialised: the
    // image is parsed into memory in one go.
    storage: 'cache',
    version: 'dev',
    baseUrl: '/toolchain/cpp/dev',
    optional: false,
    description: 'clang 23, wasm-ld and the WASI sysroot. Needed to compile C++ offline.',
    files: [
      { name: 'clang.wasm', bytes: 61_458_337 },
      { name: 'lld.wasm', bytes: 34_789_480 },
      { name: 'sysroot.bin', bytes: 22_755_492 },
    ],
  },
  {
    id: 'cpp-pch',
    label: 'C++ - szybka kompilacja',
    storage: 'cache',
    version: 'dev',
    baseUrl: '/toolchain/cpp/dev',
    optional: true,
    description:
      'Prekompilowany <bits/stdc++.h>. Skraca kompilacje z okolo 2,1 s do 0,4 s. ' +
      'Bez niego wszystko dziala, tylko wolniej.',
    files: [{ name: 'stdcpp.pch', bytes: 35_282_076 }],
  },
  {
    id: 'python',
    label: 'Python 3.13',
    storage: 'cache',
    version: '0.29.4',
    baseUrl: '/pyodide/0.29.4',
    optional: false,
    description: 'CPython 3.13 with the full standard library.',
    files: [
      { name: 'pyodide.mjs', bytes: 17_616 },
      { name: 'pyodide.asm.js', bytes: 1_074_322 },
      { name: 'pyodide.asm.wasm', bytes: 8_647_684 },
      { name: 'python_stdlib.zip', bytes: 2_424_002 },
      { name: 'pyodide-lock.json', bytes: 122_027 },
    ],
  },
  {
    id: 'numpy',
    label: 'NumPy',
    storage: 'cache',
    version: '2.2.5',
    baseUrl: '/pyodide/0.29.4',
    optional: true,
    description: 'Real NumPy compiled for wasm32. Single-threaded, no optimised BLAS.',
    files: [{ name: 'numpy-2.2.5-cp313-cp313-pyemscripten_2025_0_wasm32.whl', bytes: 2_823_762 }],
  },
];

export function getPack(id: string): AssetPack {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) throw new Error(`unknown asset pack: ${id}`);
  return pack;
}
