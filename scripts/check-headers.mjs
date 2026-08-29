#!/usr/bin/env node
/**
 * Verifies a deployed origin actually sends what the app depends on.
 *
 * Run against staging after every deploy. A reverse proxy that strips COOP/COEP, or
 * serves .wasm as application/octet-stream, breaks SharedArrayBuffer and streaming
 * compilation without producing a single error in the browser console - the app just
 * gets quietly slower and loses its interrupt handling.
 *
 *   node scripts/check-headers.mjs https://sioditor.example.org
 */
const origin = process.argv[2];
if (!origin) {
  console.error('usage: check-headers.mjs <origin>');
  process.exit(2);
}

const failures = [];
const check = (label, actual, expected) => {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual ?? '(absent)'}`);
  if (!ok) failures.push(label);
};

const shell = await fetch(new URL('/', origin));
check('COOP on /', shell.headers.get('cross-origin-opener-policy'), 'same-origin');
check(
  'COEP on /',
  shell.headers.get('cross-origin-embedder-policy'),
  (v) => v === 'require-corp' || v === 'credentialless',
);
check('shell is revalidated', shell.headers.get('cache-control'), (v) =>
  /no-cache|max-age=0/.test(v ?? ''),
);

const wasm = await fetch(new URL('/pyodide/0.29.4/pyodide.asm.wasm', origin));
check('wasm content-type', wasm.headers.get('content-type'), (v) =>
  (v ?? '').startsWith('application/wasm'),
);
check('wasm is immutable', wasm.headers.get('cache-control'), (v) => /immutable/.test(v ?? ''));

// Requested without Accept-Encoding negotiation visible to us, so this only reports.
const encoding = wasm.headers.get('content-encoding');
console.log(`info  wasm content-encoding: ${encoding ?? '(identity)'}`);
if (encoding !== 'br') {
  console.log('      note: serving identity or gzip costs roughly 30% more bytes here.');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall header checks passed');
