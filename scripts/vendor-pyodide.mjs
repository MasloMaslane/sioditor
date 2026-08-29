#!/usr/bin/env node
/**
 * Copies the Pyodide core out of node_modules into the app's public tree, and fetches the
 * optional wheels that npm does not ship.
 *
 * Everything must be same-origin: under `Cross-Origin-Embedder-Policy: require-corp` a
 * cross-origin subresource is blocked unless it carries `Cross-Origin-Resource-Policy`,
 * which we cannot set on jsDelivr. Vendoring at build time also means a contest is never
 * one CDN outage away from having no Python.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const PYODIDE_VERSION = '0.29.4';

/** The minimum set `loadPyodide` needs. The full distribution is 200+ MB of wheels. */
const CORE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

/**
 * Optional packages by name. The exact wheel filename and its digest are read from
 * pyodide-lock.json rather than written here: the tag encodes the ABI and Emscripten
 * version (0.29.4 uses `pyemscripten_2025_0`, not `pyodide_2025_0`), so a hardcoded
 * filename silently rots on every Pyodide bump.
 */
const OPTIONAL_PACKAGES = ['numpy'];

const target = join(repoRoot, 'apps/web/public/pyodide', PYODIDE_VERSION);

async function main() {
  const packageJson = require.resolve('pyodide/package.json', {
    paths: [join(repoRoot, 'packages/runtime-python')],
  });
  const source = dirname(packageJson);
  const installed = require(packageJson).version;
  if (installed !== PYODIDE_VERSION) {
    throw new Error(
      `expected pyodide ${PYODIDE_VERSION} but node_modules has ${installed}; ` +
        'the vendored files and the pack manifest must agree',
    );
  }

  await mkdir(target, { recursive: true });

  const manifest = [];
  for (const name of CORE_FILES) {
    const from = join(source, name);
    const to = join(target, name);
    await copyFile(from, to);
    manifest.push({ name, bytes: (await stat(to)).size, optional: false });
    console.log(`  ${name}`);
  }

  const lock = JSON.parse(await readFile(join(target, 'pyodide-lock.json'), 'utf8'));
  console.log(`  (CPython ${lock.info.python}, abi ${lock.info.abi_version})`);

  for (const packageName of OPTIONAL_PACKAGES) {
    const entry = lock.packages[packageName];
    if (!entry) throw new Error(`${packageName} is not in pyodide-lock.json`);
    const name = entry.file_name;
    const to = join(target, name);

    let buffer;
    try {
      buffer = await readFile(to);
      console.log(`  ${name} (already present)`);
    } catch {
      const url = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/${name}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(to, buffer);
      console.log(`  ${name} (fetched)`);
    }

    // The lock file carries a digest; a wheel that fails it would fail far less legibly
    // later, inside the Python import machinery.
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== entry.sha256) {
      throw new Error(`${name} sha256 mismatch: expected ${entry.sha256}, got ${digest}`);
    }

    manifest.push({ name, bytes: buffer.byteLength, optional: true });
  }

  // Written so the pack manifest in @sioditor/storage can be checked against reality
  // rather than against a number somebody typed from memory.
  await writeFile(
    join(target, 'vendored.json'),
    `${JSON.stringify({ version: PYODIDE_VERSION, files: manifest }, null, 2)}\n`,
  );

  const total = manifest.reduce((sum, f) => sum + f.bytes, 0);
  console.log(`vendored pyodide ${PYODIDE_VERSION}: ${(total / 1024 / 1024).toFixed(1)} MB`);
}

await main();
