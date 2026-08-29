import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace, MAX_REVISIONS_PER_PROBLEM, testsOf, type Problem } from '../src/workspace.js';

/**
 * Deleting is asynchronous and is *blocked* while any connection is open, so this has to
 * be awaited. Firing it and moving on left every test after the first hanging on an open
 * that never resolved.
 */
const freshDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('sioditor-workspace');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('could not delete the test database'));
    request.onblocked = () => reject(new Error('deleteDatabase blocked: a connection is open'));
  });

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: 'p1',
  name: 'Zadanie A',
  language: 'cpp',
  source: 'int main() {}',
  stdin: '',
  timeLimitMs: 5000,
  memoryLimitBytes: 256 * 1024 * 1024,
  updatedAt: 1,
  ...over,
});

describe('workspace', () => {
  let workspace: Workspace;
  beforeEach(async () => {
    await freshDatabase();
    workspace = new Workspace();
  });
  afterEach(() => workspace.close());

  it('round-trips a problem', async () => {
    await workspace.save(problem());
    expect((await workspace.get('p1'))?.source).toBe('int main() {}');
  });

  it('lists most recently touched first', async () => {
    await workspace.save(problem({ id: 'a', updatedAt: 1 }));
    await workspace.save(problem({ id: 'b', updatedAt: 5 }));
    expect((await workspace.list()).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('deletes a problem and its revisions together', async () => {
    await workspace.save(problem());
    await workspace.recordRevision('p1', 'v1', 1);
    await workspace.remove('p1');
    expect(await workspace.get('p1')).toBeUndefined();
    expect(await workspace.revisions('p1')).toEqual([]);
  });
});

describe('revisions', () => {
  let workspace: Workspace;
  beforeEach(async () => {
    await freshDatabase();
    workspace = new Workspace();
  });
  afterEach(() => workspace.close());

  it('keeps distinct versions, newest first', async () => {
    await workspace.recordRevision('p1', 'one', 0);
    await workspace.recordRevision('p1', 'two', 200_000);
    expect((await workspace.revisions('p1')).map((r) => r.source)).toEqual(['two', 'one']);
  });

  it('ignores a save that changed nothing', async () => {
    await workspace.recordRevision('p1', 'same', 0);
    await workspace.recordRevision('p1', 'same', 200_000);
    expect(await workspace.revisions('p1')).toHaveLength(1);
  });

  it('coalesces rapid edits, so autosave cannot flush the history', async () => {
    await workspace.recordRevision('p1', 'a', 0);
    await workspace.recordRevision('p1', 'ab', 1_000);
    await workspace.recordRevision('p1', 'abc', 2_000);
    const revisions = await workspace.revisions('p1');
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.source).toBe('abc');
  });

  it('caps history per problem, discarding the oldest', async () => {
    for (let i = 0; i < MAX_REVISIONS_PER_PROBLEM + 5; i++) {
      await workspace.recordRevision('p1', `v${i}`, i * 200_000);
    }
    const revisions = await workspace.revisions('p1');
    expect(revisions).toHaveLength(MAX_REVISIONS_PER_PROBLEM);
    expect(revisions[0]!.source).toBe(`v${MAX_REVISIONS_PER_PROBLEM + 4}`);
    // The oldest ones are the ones that went.
    expect(revisions.some((r) => r.source === 'v0')).toBe(false);
  });

  it('keeps each problem history separate', async () => {
    await workspace.recordRevision('p1', 'one', 0);
    await workspace.recordRevision('p2', 'two', 0);
    expect(await workspace.revisions('p1')).toHaveLength(1);
    expect(await workspace.revisions('p2')).toHaveLength(1);
  });
});

describe('test cases on a problem', () => {
  it('uses the cases when present', () => {
    const cases = [{ id: 'a', input: '1', expected: '1' }];
    expect(testsOf(problem({ tests: cases }))).toEqual(cases);
  });

  it('turns a pre-panel stdin into one input-only case, rather than losing it', () => {
    const cases = testsOf(problem({ stdin: '1 2 3' }));
    expect(cases).toHaveLength(1);
    expect(cases[0]!.input).toBe('1 2 3');
    expect(cases[0]!.expected).toBe('');
  });

  it('prefers cases over a leftover stdin', () => {
    const cases = [{ id: 'a', input: 'x', expected: '' }];
    expect(testsOf(problem({ tests: cases, stdin: 'old' }))).toEqual(cases);
  });

  it('is empty when there is nothing at all', () => {
    expect(testsOf(problem({ stdin: '   ' }))).toEqual([]);
  });
});
