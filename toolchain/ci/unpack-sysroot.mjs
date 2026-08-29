#!/usr/bin/env node
/**
 * Expands a packed sysroot image back into a directory.
 *
 * Needed because the precompiled header has to be built against the exact absolute paths
 * the browser will use - a PCH records the path of every header it consumed, and a
 * mismatch makes it useless. Mounting this directory at /sysroot under wasmtime gives the
 * compiler the same view it has in the VFS.
 *
 * Also handy for looking at what actually shipped.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [imagePath, outDir, mountPoint = 'sysroot'] = process.argv.slice(2);
if (!imagePath || !outDir) {
  console.error('usage: unpack-sysroot.mjs <sysroot.bin> <output dir> [mount point]');
  process.exit(2);
}

const image = await readFile(imagePath);
const manifestLength = image.readUInt32LE(0);
const manifest = JSON.parse(image.subarray(4, 4 + manifestLength).toString('utf8'));
const dataStart = 4 + manifestLength;

let count = 0;
for (const [virtualPath, [offset, length]] of Object.entries(manifest.files)) {
  const segments = virtualPath.split('/').filter(Boolean);
  if (segments[0] !== mountPoint) continue;
  const target = join(outDir, ...segments.slice(1));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, image.subarray(dataStart + offset, dataStart + offset + length));
  count++;
}

console.log(`unpacked ${count} files into ${outDir}`);
