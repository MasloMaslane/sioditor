#!/usr/bin/env node
/**
 * Fails the build if anything large or version-pinned reached the service worker's
 * precache manifest.
 *
 * Workbox installs precached entries eagerly and atomically, so a single toolchain file
 * in there would turn first load into a hundred-megabyte all-or-nothing download, and
 * any hash change would re-fetch the lot. The packs are supposed to be fetched on demand
 * into OPFS and Cache Storage instead.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SW = join(import.meta.dirname, '../apps/web/dist/sw.js');
const FORBIDDEN = [/\/pyodide\//, /\/toolchain\//, /\.wasm$/, /\.whl$/, /python_stdlib\.zip$/];
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

const source = await readFile(SW, 'utf8');

// The manifest is injected as an array of {url, revision} literals.
const entries = [...source.matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
if (entries.length === 0) {
  console.error('could not find a precache manifest in dist/sw.js - has the format changed?');
  process.exit(1);
}

const offenders = entries.filter((url) => FORBIDDEN.some((pattern) => pattern.test(url)));
if (offenders.length > 0) {
  console.error('these must not be precached:\n' + offenders.map((u) => `  ${u}`).join('\n'));
  process.exit(1);
}

const { statSync } = await import('node:fs');
const oversized = entries
  .map((url) => {
    const path = join(import.meta.dirname, '../apps/web/dist', url.replace(/^\//, ''));
    try {
      return { url, bytes: statSync(path).size };
    } catch {
      return { url, bytes: 0 };
    }
  })
  .filter((entry) => entry.bytes > MAX_ENTRY_BYTES);

if (oversized.length > 0) {
  console.error(
    'precache entries over 4 MB:\n' +
      oversized.map((e) => `  ${e.url} (${(e.bytes / 1024 / 1024).toFixed(1)} MB)`).join('\n'),
  );
  process.exit(1);
}

const total = entries.length;
console.log(`precache manifest ok: ${total} app-shell entries, nothing oversized`);
