import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Language } from './types.js';
import type { TestCase } from './tests.js';

/**
 * A problem: one source file, its tests, its limits.
 *
 * The unit deliberately matches how a contestant works - several tasks open at once
 * during a round, switched between constantly - rather than a general file tree.
 */
export interface Problem {
  readonly id: string;
  readonly name: string;
  readonly language: Language;
  readonly source: string;
  /**
   * Optional because problems saved before the test panel existed do not have it, and
   * IndexedDB stores records as they were written. Read it through `testsOf`.
   */
  readonly tests?: readonly TestCase[];
  /** @deprecated Superseded by `tests`; kept so old records still open. */
  readonly stdin?: string;
  readonly timeLimitMs: number;
  readonly memoryLimitBytes: number;
  /**
   * Whether a program may block asking for input the test case did not provide.
   *
   * Off by default, and that default matters: the commonest shape in this setting reads
   * until end of input (`while (cin >> x)`, `sys.stdin.read()`). With interactive input
   * always on, those never finish - they block for a line nobody is going to type, and
   * hit the time limit. It is worth having for poking at a solution by hand, which is why
   * it is a switch rather than absent.
   */
  readonly interactive?: boolean;
  readonly updatedAt: number;
}

/**
 * A previous state of a problem's source.
 *
 * Kept because losing work during a contest is the worst thing this tool could do, and an
 * accidental select-all-and-paste is a single keystroke away. Revisions are capped per
 * problem: this is an undo net, not a history feature.
 */
export interface Revision {
  readonly id?: number;
  readonly problemId: string;
  readonly source: string;
  readonly savedAt: number;
}

interface WorkspaceSchema extends DBSchema {
  problems: { key: string; value: Problem };
  revisions: {
    key: number;
    value: Revision;
    indexes: { byProblem: string };
  };
}

const DB_NAME = 'sioditor-workspace';
const DB_VERSION = 1;

/** Enough to recover from a bad paste or two, without unbounded growth. */
export const MAX_REVISIONS_PER_PROBLEM = 30;

/** Consecutive saves closer together than this replace the previous revision. */
const REVISION_COALESCE_MS = 60_000;

/**
 * A problem's test cases, including those saved before the panel existed.
 *
 * Those older records carry a single `stdin` string, which becomes one input-only case -
 * so upgrading does not silently drop the input somebody had typed.
 */
export function testsOf(problem: Problem): readonly TestCase[] {
  if (problem.tests && problem.tests.length > 0) return problem.tests;
  if (problem.stdin && problem.stdin.trim() !== '') {
    return [{ id: 'legacy', input: problem.stdin, expected: '' }];
  }
  return [];
}

export class Workspace {
  private dbPromise: Promise<IDBPDatabase<WorkspaceSchema>> | undefined;

  private db(): Promise<IDBPDatabase<WorkspaceSchema>> {
    this.dbPromise ??= openDB<WorkspaceSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('problems', { keyPath: 'id' });
        const revisions = db.createObjectStore('revisions', {
          keyPath: 'id',
          autoIncrement: true,
        });
        revisions.createIndex('byProblem', 'problemId');
      },
    });
    return this.dbPromise;
  }

  async list(): Promise<Problem[]> {
    const db = await this.db();
    const all = await db.getAll('problems');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Problem | undefined> {
    return (await this.db()).get('problems', id);
  }

  async save(problem: Problem): Promise<void> {
    const db = await this.db();
    await db.put('problems', problem);
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['problems', 'revisions'], 'readwrite');
    await tx.objectStore('problems').delete(id);
    const index = tx.objectStore('revisions').index('byProblem');
    for (const key of await index.getAllKeys(id)) {
      await tx.objectStore('revisions').delete(key);
    }
    await tx.done;
  }

  /**
   * Records a revision, coalescing rapid edits.
   *
   * Without coalescing, autosave would push a revision every few seconds and the cap
   * would discard anything older than the last minute - the opposite of useful.
   */
  async recordRevision(problemId: string, source: string, now = Date.now()): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('revisions', 'readwrite');
    const store = tx.objectStore('revisions');
    const index = store.index('byProblem');
    const existing = (await index.getAll(problemId)).sort((a, b) => a.savedAt - b.savedAt);

    const latest = existing[existing.length - 1];
    if (latest?.source === source) {
      await tx.done;
      return;
    }

    if (latest && now - latest.savedAt < REVISION_COALESCE_MS && latest.id !== undefined) {
      await store.put({ ...latest, source, savedAt: now });
      await tx.done;
      return;
    }

    await store.add({ problemId, source, savedAt: now });

    const surplus = existing.length + 1 - MAX_REVISIONS_PER_PROBLEM;
    for (let i = 0; i < surplus; i++) {
      const victim = existing[i];
      if (victim?.id !== undefined) await store.delete(victim.id);
    }
    await tx.done;
  }

  /**
   * Releases the connection.
   *
   * An open connection blocks deleteDatabase and any version upgrade, so this is needed
   * both by tests and by a future schema migration.
   */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = undefined;
  }

  /** Most recent first. */
  async revisions(problemId: string): Promise<Revision[]> {
    const db = await this.db();
    const all = await db.getAllFromIndex('revisions', 'byProblem', problemId);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }
}
