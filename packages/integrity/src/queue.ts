import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionChunk } from './chain.js';

interface QueueSchema extends DBSchema {
  chunks: { key: number; value: SessionChunk & { readonly delivered: 0 | 1 } };
  meta: { key: string; value: number | string };
}

const DB_NAME = 'sioditor-integrity';
const DB_VERSION = 1;

/**
 * Durable store for recorded chunks.
 *
 * Everything is written here *before* any attempt to send it, and only marked delivered
 * once the server has acknowledged. A closed laptop, a dead server, or a network that
 * disappears mid-round therefore costs nothing: the chunks are on disk and will be sent
 * whenever delivery next becomes possible.
 *
 * Delivered chunks are kept rather than deleted, so a session can be re-sent if the
 * server lost it - which has happened to every ingest endpoint ever written.
 */
export class ChunkQueue {
  private dbPromise: Promise<IDBPDatabase<QueueSchema>> | undefined;

  private db(): Promise<IDBPDatabase<QueueSchema>> {
    this.dbPromise ??= openDB<QueueSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('chunks', { keyPath: 'seq' });
        db.createObjectStore('meta');
      },
    });
    return this.dbPromise;
  }

  async append(chunk: SessionChunk): Promise<void> {
    const db = await this.db();
    await db.put('chunks', { ...chunk, delivered: 0 });
  }

  /** Oldest first, so the server sees the session in order when it can. */
  async pending(limit = 32): Promise<SessionChunk[]> {
    const db = await this.db();
    const all = await db.getAll('chunks');
    return all
      .filter((chunk) => chunk.delivered === 0)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
  }

  async markDelivered(seqs: readonly number[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('chunks', 'readwrite');
    for (const seq of seqs) {
      const existing = await tx.store.get(seq);
      if (existing) await tx.store.put({ ...existing, delivered: 1 });
    }
    await tx.done;
  }

  async all(): Promise<SessionChunk[]> {
    const db = await this.db();
    return (await db.getAll('chunks')).sort((a, b) => a.seq - b.seq);
  }

  async pendingCount(): Promise<number> {
    return (await this.pending(Number.MAX_SAFE_INTEGER)).length;
  }

  /** The next sequence number, so a reload continues the chain rather than restarting it. */
  async nextSeq(): Promise<number> {
    const db = await this.db();
    const all = await db.getAll('chunks');
    return all.reduce((highest, chunk) => Math.max(highest, chunk.seq + 1), 0);
  }

  async lastHash(): Promise<string> {
    const db = await this.db();
    const all = await db.getAll('chunks');
    if (all.length === 0) return '';
    return all.reduce((latest, chunk) => (chunk.seq > latest.seq ? chunk : latest)).hash;
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    (await this.dbPromise).close();
    this.dbPromise = undefined;
  }
}
