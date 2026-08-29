#!/usr/bin/env node
/**
 * Packs the parts of a wasi-sysroot the browser compiler needs into one indexed image.
 *
 * Format: [4-byte LE manifest length][UTF-8 JSON manifest][concatenated file bytes].
 * The manifest maps a virtual path to [offset, length], so the VFS answers path_open with
 * a Map lookup and serves reads as subarray views - no per-file allocation, no copies.
 *
 * The alternative shapes are both worse: a tar means parsing ~1,400 headers in JS on every
 * cold start, and per-file HTTP fetches mean ~1,400 requests and no offline story at all.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const [sysrootArg, outArg] = process.argv.slice(2);
if (!sysrootArg || !outArg) {
  console.error('usage: pack-sysroot.mjs <wasi-sysroot dir> <output dir>');
  process.exit(2);
}

const TRIPLE = 'wasm32-wasip1';

/**
 * The no-exceptions multilib.
 *
 * The `eh` variant would be preferable - std::stoi and vector::at throw - but wasi-sdk
 * 34.0 ships it in a state Chrome rejects: linking against it produces a module that
 * "uses a mix of legacy and new exception handling instructions", and no combination of
 * -mllvm -wasm-use-legacy-eh on our own translation unit fixes it, because the
 * inconsistency is inside the prebuilt archives. Verified against Chrome 151 and V8 in
 * Node 23. See docs/toolchain.md.
 *
 * `noeh` is self-consistent and works. The cost is that throwing code fails to link;
 * diagnostics.ts turns that into a comprehensible message.
 */
const VARIANT = 'noeh';

/**
 * Clang's resource headers are ~7.5 MB, almost all of it architecture intrinsics for
 * targets a wasm build will never see. Excluding by architecture rather than listing the
 * keepers by name: clang splits these headers further every few releases (23 introduced
 * the `__*_header_macro.h` family), and an allowlist silently omits the new ones, which
 * surfaces much later as "'__float_header_macro.h' file not found" in the middle of
 * <cfloat>. A denylist lets new helpers through by default.
 *
 * This keeps roughly 500 KB.
 */
const ARCH_SPECIFIC_HEADER = new RegExp(
  [
    'intrin',
    'opencl',
    'altivec',
    'vecintrin',
    'hexagon',
    'hvx',
    'arm_',
    'arm64',
    'armintr',
    'aarch64',
    'riscv',
    'ppc',
    's390',
    'amdgpu',
    'amdhsa',
    'nvptx',
    'cuda',
    'hip_',
    'sifive',
    'andes',
    'xtensa',
    'msa',
    'mm3dnow',
    'spirv',
    'gpu_',
  ].join('|'),
);

/** wasm_simd128.h is the one intrinsics header that is relevant here. */
const KEEP_ANYWAY = new Set(['wasm_simd128.h']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Everything the compiler opens, mapped to the absolute paths baked in via DEFAULT_SYSROOT. */
async function collect(sysroot) {
  const entries = [];
  const add = (source, virtualPath) => entries.push({ source, virtualPath });

  // libc++ headers, minus the C++03 tree: 4.3 MB and 606 files that C++23 never touches.
  const cxxRoot = join(sysroot, 'include', TRIPLE, VARIANT, 'c++', 'v1');
  for (const file of await walk(cxxRoot)) {
    const rel = relative(cxxRoot, file);
    if (rel.startsWith('__cxx03')) continue;
    add(file, posix.join('/sysroot/include/c++/v1', rel.split(/[\\/]/).join('/')));
  }

  // wasi-libc C headers.
  const cRoot = join(sysroot, 'include', TRIPLE);
  for (const file of await walk(cRoot)) {
    const rel = relative(cRoot, file).split(/[\\/]/).join('/');
    // Skip every multilib subtree, not just the one we are not using: the C++ headers
    // are collected separately above, and letting them through here would ship both
    // variants. (This filter previously named the variants explicitly and silently
    // doubled the image when VARIANT changed.)
    if (rel.startsWith('eh/') || rel.startsWith('noeh/')) continue;
    add(file, posix.join('/sysroot/include', rel));
  }

  const libRoot = join(sysroot, 'lib', TRIPLE);
  const libs = [
    ['crt1.o', 'crt1.o'],
    ['libc.a', 'libc.a'],
    ['libwasi-emulated-mman.a', 'libwasi-emulated-mman.a'],
    ['libwasi-emulated-signal.a', 'libwasi-emulated-signal.a'],
    ['libwasi-emulated-getpid.a', 'libwasi-emulated-getpid.a'],
    ['libwasi-emulated-process-clocks.a', 'libwasi-emulated-process-clocks.a'],
    [`${VARIANT}/libc++.a`, 'libc++.a'],
    [`${VARIANT}/libc++abi.a`, 'libc++abi.a'],
  ];
  for (const [from, to] of libs) {
    const source = join(libRoot, from);
    try {
      await stat(source);
      add(source, posix.join('/sysroot/lib', to));
    } catch {
      console.warn(`  ! missing ${from}`);
    }
  }

  // Clang's own resource headers (stddef.h, stdarg.h, the __stddef_* family). Without
  // these nothing compiles: libc++ reaches them through #include_next.
  // sysroot is <sdk>/share/wasi-sysroot, so the SDK root is two levels up.
  const resourceRoot = join(sysroot, '..', '..', 'lib', 'clang');
  try {
    for (const version of await readdir(resourceRoot)) {
      const dir = join(resourceRoot, version, 'include');
      for (const file of await walk(dir)) {
        const rel = relative(dir, file).split(/[\\/]/).join('/');
        if (rel.includes('/')) continue; // skip the per-architecture subdirectories
        if (!KEEP_ANYWAY.has(rel) && ARCH_SPECIFIC_HEADER.test(rel)) continue;
        add(file, posix.join('/sysroot/include/clang', rel));
      }
      break;
    }
  } catch {
    console.warn('  ! no clang resource headers found');
  }

  // GNU compatibility headers - <bits/stdc++.h> and the pb_ds shim. Placed ahead of the
  // libc++ tree on the include path, which is what makes OI code compile unchanged.
  const gnuCompat = join(repoRoot, 'packages/gnu-compat/include');
  try {
    for (const file of await walk(gnuCompat)) {
      const rel = relative(gnuCompat, file).split(/[\\/]/).join('/');
      add(file, posix.join('/sysroot/include', rel));
    }
  } catch {
    console.warn('  ! no gnu-compat headers found');
  }

  // __int128 lowers to __multi3, which lives in the builtins archive.
  // wasi-sdk-34 keeps this under lib/clang/<v>/lib/, not in the sysroot.
  for (const root of [join(sysroot, 'lib'), join(sysroot, '..', '..', 'lib', 'clang')]) {
    let found = false;
    try {
      for (const file of await walk(root)) {
        if (!/libclang_rt\.builtins\.a$/.test(file)) continue;
        if (!/wasm32-unknown-wasip1(?!-)/.test(file)) continue;
        add(file, '/sysroot/lib/libclang_rt.builtins.a');
        found = true;
        break;
      }
    } catch {
      /* directory absent; try the next candidate */
    }
    if (found) break;
  }

  return entries;
}

async function main() {
  const entries = await collect(sysrootArg);
  entries.sort((a, b) => (a.virtualPath < b.virtualPath ? -1 : 1));

  const files = {};
  const directories = new Set(['/sysroot']);
  const chunks = [];
  let offset = 0;

  const seen = new Map();
  for (const { source, virtualPath } of entries) {
    // A duplicate silently overwrites, which would mean shipping a header that is not the
    // one anybody thinks it is. Fail loudly instead.
    if (seen.has(virtualPath)) {
      throw new Error(
        `two sources map to ${virtualPath}:\n  ${seen.get(virtualPath)}\n  ${source}`,
      );
    }
    seen.set(virtualPath, source);

    const bytes = await readFile(source);
    files[virtualPath] = [offset, bytes.byteLength];
    chunks.push(bytes);
    offset += bytes.byteLength;

    // clang stats directories during header search, so fd_readdir and O_DIRECTORY need
    // every ancestor to exist as a real entry.
    let dir = posix.dirname(virtualPath);
    while (dir !== '/' && !directories.has(dir)) {
      directories.add(dir);
      dir = posix.dirname(dir);
    }
  }

  const manifest = Buffer.from(
    JSON.stringify({ files, directories: [...directories].sort() }),
    'utf8',
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(manifest.byteLength, 0);
  const image = Buffer.concat([header, manifest, ...chunks]);

  await mkdir(outArg, { recursive: true });
  await writeFile(join(outArg, 'sysroot.bin'), image);

  const digest = createHash('sha256').update(image).digest('hex');
  await writeFile(
    join(outArg, 'sysroot.json'),
    `${JSON.stringify(
      {
        bytes: image.byteLength,
        fileCount: entries.length,
        directoryCount: directories.size,
        manifestBytes: manifest.byteLength,
        sha256: digest,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `sysroot.bin: ${(image.byteLength / 1024 / 1024).toFixed(1)} MB, ` +
      `${entries.length} files, ${directories.size} dirs, manifest ${(manifest.byteLength / 1024).toFixed(0)} KB`,
  );
}

await main();
