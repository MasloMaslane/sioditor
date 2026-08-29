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
import { join, posix, relative } from 'node:path';

const [sysrootArg, outArg] = process.argv.slice(2);
if (!sysrootArg || !outArg) {
  console.error('usage: pack-sysroot.mjs <wasi-sysroot dir> <output dir>');
  process.exit(2);
}

const TRIPLE = 'wasm32-wasip1';

/**
 * Only the exception-enabled variant ships. Selecting it needs `-fwasm-exceptions` on the
 * compile line (the driver defaults to `noeh`), which flags.ts passes.
 */
const VARIANT = 'eh';

/** Clang's resource headers are ~7.8 MB, almost all x86/ARM/GPU intrinsics. Take the rest. */
const RESOURCE_HEADERS = new Set([
  '__stddef_max_align_t.h',
  '__stddef_null.h',
  '__stddef_nullptr_t.h',
  '__stddef_offsetof.h',
  '__stddef_ptrdiff_t.h',
  '__stddef_rsize_t.h',
  '__stddef_size_t.h',
  '__stddef_unreachable.h',
  '__stddef_wchar_t.h',
  '__stddef_wint_t.h',
  '__stdarg___gnuc_va_list.h',
  '__stdarg___va_copy.h',
  '__stdarg_va_arg.h',
  '__stdarg_va_copy.h',
  '__stdarg_va_list.h',
  'stddef.h',
  'stdarg.h',
  'stdint.h',
  'limits.h',
  'float.h',
  'stdbool.h',
  'stdalign.h',
  'iso646.h',
  'inttypes.h',
  'stdckdint.h',
  'stdatomic.h',
  'stdnoreturn.h',
  '__float_types.h',
  'module.modulemap',
  'wasm_simd128.h',
]);

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
    if (rel.startsWith(`${VARIANT}/`) || rel.startsWith('noeh/')) continue;
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

  // __int128 lowers to __multi3, which lives in the builtins archive.
  for (const file of await walk(join(sysroot, 'lib'))) {
    if (/libclang_rt\.builtins.*\.a$/.test(file) && file.includes('wasip1')) {
      add(file, '/sysroot/lib/libclang_rt.builtins.a');
      break;
    }
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

  for (const { source, virtualPath } of entries) {
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
