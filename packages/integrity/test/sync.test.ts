import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkQueue } from '../src/queue.js';
import { SyncLoop, type Transport } from '../src/sync.js';
import { sealChunk, type SessionChunk } from '../src/chain.js';

const freshDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('sioditor-integrity');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('could not clear the queue'));
    request.onblocked = () => reject(new Error('a connection is still open'));
  });

async function chunk(queue: ChunkQueue, seq?: number): Promise<SessionChunk> {
  const next = seq ?? (await queue.nextSeq());
  const sealed = await sealChunk({
    sessionId: 's',
    participantId: 'p',
    seq: next,
    prevHash: await queue.lastHash(),
    events: [{ t: 'beat', at: next }],
  });
  await queue.append(sealed);
  return sealed;
}

/** A server that can be switched off, and remembers what it received. */
function fakeServer() {
  const received: number[] = [];
  let up = true;
  let calls = 0;
  const transport: Transport = {
    async send(chunks) {
      calls++;
      if (!up) throw new Error('server unreachable');
      for (const c of chunks) if (!received.includes(c.seq)) received.push(c.seq);
      return chunks.map((c) => c.seq);
    },
  };
  return {
    transport,
    received,
    get calls() {
      return calls;
    },
    down: () => {
      up = false;
    },
    up: () => {
      up = true;
    },
  };
}

describe('delivery', () => {
  let queue: ChunkQueue;
  beforeEach(async () => {
    await freshDatabase();
    queue = new ChunkQueue();
  });
  afterEach(async () => {
    await queue.close();
  });

  it('delivers what was recorded and marks it acknowledged', async () => {
    await chunk(queue);
    await chunk(queue);
    const server = fakeServer();
    await new SyncLoop({ queue, transport: server.transport }).flush();

    expect(server.received).toEqual([0, 1]);
    expect(await queue.pendingCount()).toBe(0);
  });

  it('keeps everything when the server is down, and loses nothing', async () => {
    await chunk(queue);
    const server = fakeServer();
    server.down();

    const loop = new SyncLoop({ queue, transport: server.transport });
    await loop.flush();

    // The point of the whole design: a failed send costs a retry, not an event.
    expect(await queue.pendingCount()).toBe(1);
    expect(server.received).toEqual([]);
  });

  it('sends the backlog in order once the server returns', async () => {
    const server = fakeServer();
    server.down();
    const loop = new SyncLoop({ queue, transport: server.transport });

    await chunk(queue);
    await loop.flush();
    await chunk(queue);
    await loop.flush();
    expect(await queue.pendingCount()).toBe(2);

    server.up();
    await loop.flush();
    expect(server.received).toEqual([0, 1]);
    expect(await queue.pendingCount()).toBe(0);
  });

  it('does not re-send what was already acknowledged', async () => {
    await chunk(queue);
    const server = fakeServer();
    const loop = new SyncLoop({ queue, transport: server.transport });
    await loop.flush();
    await loop.flush();
    expect(server.received).toEqual([0]);
  });

  it('re-sends a chunk whose acknowledgement was lost', async () => {
    // The server took it but the response never arrived. The client must try again, and
    // the server must tolerate the duplicate - which is why ingest is idempotent.
    await chunk(queue);
    let firstAttempt = true;
    const seen: number[] = [];
    const transport: Transport = {
      async send(chunks) {
        seen.push(...chunks.map((c) => c.seq));
        if (firstAttempt) {
          firstAttempt = false;
          throw new Error('connection dropped after the server committed');
        }
        return chunks.map((c) => c.seq);
      },
    };

    const loop = new SyncLoop({ queue, transport });
    await loop.flush();
    await loop.flush();
    expect(seen).toEqual([0, 0]);
    expect(await queue.pendingCount()).toBe(0);
  });

  it('accepts a partial acknowledgement and retries only the rest', async () => {
    await chunk(queue);
    await chunk(queue);
    const transport: Transport = {
      async send(chunks) {
        return [chunks[0]!.seq];
      },
    };
    await new SyncLoop({ queue, transport }).flush();
    expect((await queue.pending()).map((c) => c.seq)).toEqual([1]);
  });

  it('reports what is waiting, so the contestant can be told', async () => {
    await chunk(queue);
    const server = fakeServer();
    server.down();
    const states: number[] = [];
    const loop = new SyncLoop({
      queue,
      transport: server.transport,
      onStateChange: (state) => states.push(state.pending),
    });
    await loop.flush();
    expect(states.at(-1)).toBe(1);
  });
});

/** An in-memory stand-in, so timing tests never touch IndexedDB. */
function memoryStore(seqs: number[]) {
  const delivered = new Set<number>();
  return {
    async pending() {
      return seqs
        .filter((seq) => !delivered.has(seq))
        .map((seq) => ({ seq }) as unknown as SessionChunk);
    },
    async markDelivered(accepted: readonly number[]) {
      for (const seq of accepted) delivered.add(seq);
    },
    async pendingCount() {
      return seqs.filter((seq) => !delivered.has(seq)).length;
    },
  };
}

describe('retrying a dead server', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('backs off exponentially rather than hammering it', async () => {
    const server = fakeServer();
    server.down();
    const loop = new SyncLoop({
      queue: memoryStore([0]),
      transport: server.transport,
      baseDelayMs: 100,
    });
    loop.start();

    await vi.advanceTimersByTimeAsync(1);
    expect(server.calls).toBe(1);

    // 100 ms after the first failure, then 200, then 400 - not once a second.
    await vi.advanceTimersByTimeAsync(100);
    expect(server.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(server.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(server.calls).toBe(3);

    loop.stop();
  });

  it('caps the delay, so recovery is prompt after a long outage', async () => {
    const server = fakeServer();
    server.down();
    const loop = new SyncLoop({
      queue: memoryStore([0]),
      transport: server.transport,
      baseDelayMs: 100,
      maxDelayMs: 300,
    });
    loop.start();

    await vi.advanceTimersByTimeAsync(10_000);
    const duringOutage = server.calls;
    server.up();
    await vi.advanceTimersByTimeAsync(400);

    expect(server.calls).toBeGreaterThan(duringOutage);
    expect(server.received).toEqual([0]);
    loop.stop();
  });

  it('stops attempting once stopped', async () => {
    const server = fakeServer();
    server.down();
    const loop = new SyncLoop({
      queue: memoryStore([0]),
      transport: server.transport,
      baseDelayMs: 100,
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(1);
    loop.stop();
    const calls = server.calls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toBe(calls);
  });
});

describe('the queue across a reload', () => {
  let queue: ChunkQueue;
  beforeEach(async () => {
    await freshDatabase();
    queue = new ChunkQueue();
  });
  afterEach(() => queue.close());

  it('continues the chain rather than restarting it', async () => {
    await chunk(queue);
    await chunk(queue);
    await queue.close();

    // A new page load, same database.
    const reopened = new ChunkQueue();
    expect(await reopened.nextSeq()).toBe(2);
    expect(await reopened.lastHash()).not.toBe('');
    expect(await reopened.pendingCount()).toBe(2);
    await reopened.close();
  });

  it('keeps delivered chunks, so a session can be re-sent if the server lost it', async () => {
    await chunk(queue);
    await queue.markDelivered([0]);
    expect(await queue.all()).toHaveLength(1);
    expect(await queue.pendingCount()).toBe(0);
  });
});
