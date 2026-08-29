import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionChunk } from '@sioditor/integrity';

/**
 * Append-only storage, one JSON-lines file per participant.
 *
 * A database would be more machinery than this earns. The workload is append a chunk,
 * read a participant back: no updates, no joins, no deletes until retention expires.
 * Files bring three things that matter for something an organiser self-hosts - an append
 * survives a crash mid-write without corrupting what came before, the data is readable
 * with `cat` when something needs explaining, and archiving a round is copying a
 * directory.
 */
export class SessionStore {
  /** Serialises appends per file: concurrent writes to one file would interleave. */
  private writes = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  private path(sessionId: string, participantId: string): string {
    // Both come from the network, so neither may reach outside the data directory.
    return join(this.root, safe(sessionId), `${safe(participantId)}.jsonl`);
  }

  /**
   * Stores chunks, ignoring any already held.
   *
   * Idempotent by sequence number, and that is not a nicety: a client whose
   * acknowledgement was lost will send the same chunk again, and the honest thing is to
   * accept it and report it accepted rather than fail or duplicate.
   */
  async append(
    sessionId: string,
    participantId: string,
    chunks: readonly SessionChunk[],
  ): Promise<number[]> {
    const file = this.path(sessionId, participantId);
    const previous = this.writes.get(file) ?? Promise.resolve();

    const work = previous.then(async () => {
      const existing = new Set((await this.read(sessionId, participantId)).map((c) => c.seq));
      const fresh = chunks.filter((chunk) => !existing.has(chunk.seq));

      if (fresh.length > 0) {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, fresh.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n');
      }
      // Everything offered is acknowledged, including what was already held - the client
      // needs to stop retrying those.
      return chunks.map((chunk) => chunk.seq);
    });

    this.writes.set(
      file,
      work.catch(() => undefined),
    );
    return work;
  }

  async read(sessionId: string, participantId: string): Promise<SessionChunk[]> {
    try {
      const raw = await readFile(this.path(sessionId, participantId), 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as SessionChunk)
        .sort((a, b) => a.seq - b.seq);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }

  async participants(sessionId: string): Promise<string[]> {
    try {
      const entries = await readdir(join(this.root, safe(sessionId)));
      return entries.filter((n) => n.endsWith('.jsonl')).map((n) => n.replace(/\.jsonl$/, ''));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }

  async sessions(): Promise<string[]> {
    try {
      return await readdir(this.root);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }
}

/** Ids reach the filesystem, so anything that is not plainly an id is rejected. */
function safe(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`unusable id: ${JSON.stringify(id.slice(0, 32))}`);
  }
  return id;
}
