import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKS } from '../src/packs.js';

const vendored = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../apps/web/public/pyodide/0.29.4/vendored.json'),
    'utf8',
  ),
) as { version: string; files: Array<{ name: string; bytes: number }> };

/**
 * The manifest drives the download progress bar, so a stale entry shows users a bar that
 * finishes at 140% or stalls at 80%. It is written by hand and the files are produced by
 * a script, so nothing but a test keeps the two honest.
 */
describe('pyodide pack manifest', () => {
  const byName = new Map(vendored.files.map((f) => [f.name, f.bytes]));
  const packs = PACKS.filter((pack) => pack.baseUrl.includes('/pyodide/'));

  it('covers every vendored file exactly once', () => {
    const declared = packs.flatMap((pack) => pack.files.map((f) => f.name)).sort();
    expect(declared).toEqual([...byName.keys()].sort());
  });

  it.each(packs.flatMap((pack) => pack.files.map((file) => [pack.id, file] as const)))(
    '%s declares the real size of %s',
    (_packId, file) => {
      expect(file.bytes).toBe(byName.get(file.name));
    },
  );

  it('pins the version the vendor script produced', () => {
    for (const pack of packs) expect(pack.baseUrl).toContain(vendored.version);
  });
});
