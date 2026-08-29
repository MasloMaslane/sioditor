import { describe, expect, it } from 'vitest';
import { exportWorkspace, importWorkspace } from '../src/archive.js';
import type { Problem } from '../src/workspace.js';
import { unzipSync, zipSync } from 'fflate';

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: 'p1',
  name: 'Zadanie A',
  language: 'cpp',
  source: 'int main() { return 0; }',
  tests: [{ id: 't1', input: '1 2', expected: '3' }],
  timeLimitMs: 3000,
  memoryLimitBytes: 128 * 1048576,
  updatedAt: 5,
  ...over,
});

const names = (archive: Uint8Array) => Object.keys(unzipSync(archive)).sort();

describe('exporting', () => {
  it('lays out one directory per problem, with judge-shaped test files', () => {
    expect(names(exportWorkspace([problem()]))).toEqual([
      'Zadanie A/main.cpp',
      'Zadanie A/tests/01.in',
      'Zadanie A/tests/01.out',
      'sioditor.json',
    ]);
  });

  it('uses the right extension per language', () => {
    const archive = exportWorkspace([problem({ language: 'python' })]);
    expect(names(archive)).toContain('Zadanie A/main.py');
  });

  it('omits the .out file when there is nothing expected', () => {
    const archive = exportWorkspace([problem({ tests: [{ id: 't', input: '1', expected: '' }] })]);
    expect(names(archive)).not.toContain('Zadanie A/tests/01.out');
    expect(names(archive)).toContain('Zadanie A/tests/01.in');
  });

  it('keeps two problems with the same name apart', () => {
    const archive = exportWorkspace([problem({ id: 'a' }), problem({ id: 'b' })]);
    const directories = names(archive)
      .filter((n) => n.endsWith('main.cpp'))
      .map((n) => n.split('/')[0]);
    expect(new Set(directories).size).toBe(2);
  });

  it('replaces characters a filesystem would object to', () => {
    const archive = exportWorkspace([problem({ name: 'a/b:c*d' })]);
    const directory = names(archive)[0]!.split('/')[0]!;
    expect(directory).not.toMatch(/[/:*]/);
  });
});

describe('round trip', () => {
  it('brings back sources, tests and limits', () => {
    const original = problem({ name: 'Suma', timeLimitMs: 1500 });
    const [restored] = importWorkspace(exportWorkspace([original]));
    expect(restored).toMatchObject({
      name: 'Suma',
      language: 'cpp',
      source: original.source,
      timeLimitMs: 1500,
      memoryLimitBytes: 128 * 1048576,
    });
    expect(restored!.tests).toEqual([expect.objectContaining({ input: '1 2', expected: '3' })]);
  });

  it('assigns fresh ids, so importing twice does not collide', () => {
    const archive = exportWorkspace([problem()]);
    const first = importWorkspace(archive);
    const second = importWorkspace(archive);
    expect(first[0]!.id).not.toBe(second[0]!.id);
  });

  it('keeps several problems', () => {
    const archive = exportWorkspace([problem({ name: 'A' }), problem({ name: 'B' })]);
    expect(
      importWorkspace(archive)
        .map((p) => p.name)
        .sort(),
    ).toEqual(['A', 'B']);
  });
});

describe('importing an archive that did not come from here', () => {
  it('works without a manifest, guessing the language from the extension', () => {
    const archive = exportWorkspace([problem({ language: 'python' })]);
    const files = unzipSync(archive);
    delete files['sioditor.json'];
    const [restored] = importWorkspace(rezip(files));
    expect(restored!.language).toBe('python');
    expect(restored!.name).toBe('Zadanie A');
  });

  it('falls back to default limits when the manifest is absent', () => {
    const files = unzipSync(exportWorkspace([problem()]));
    delete files['sioditor.json'];
    const [restored] = importWorkspace(rezip(files));
    expect(restored!.timeLimitMs).toBe(5000);
  });

  it('survives a corrupt manifest rather than refusing the archive', () => {
    const files = unzipSync(exportWorkspace([problem()]));
    files['sioditor.json'] = new TextEncoder().encode('{ not json');
    const restored = importWorkspace(rezip(files));
    expect(restored).toHaveLength(1);
  });
});

/** Rebuilds an archive after tampering with its contents. */
function rezip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}
