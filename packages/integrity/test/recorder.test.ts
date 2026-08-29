import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkQueue } from '../src/queue.js';
import { Recorder } from '../src/recorder.js';
import { verifyChain } from '../src/chain.js';
import { PASTE_TEXT_THRESHOLD } from '../src/events.js';

const freshDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('sioditor-integrity');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('could not clear the queue'));
    request.onblocked = () => reject(new Error('a connection is still open'));
  });

let queue: ChunkQueue;
let recorder: Recorder;

beforeEach(async () => {
  await freshDatabase();
  queue = new ChunkQueue();
  recorder = new Recorder({ sessionId: 'round1', participantId: 'kowalski', queue });
});
afterEach(() => queue.close());

const edit = (over: Partial<Parameters<Recorder['recordEdit']>[1]> = {}) => ({
  at: 1,
  from: 0,
  to: 0,
  inserted: 'x',
  source: 'input',
  ...over,
});

describe('recording', () => {
  it('seals buffered events into a verifiable chain', async () => {
    await recorder.recordEdit('p1', edit());
    await recorder.seal();
    await recorder.recordEdit('p1', edit({ at: 2 }));
    await recorder.seal();

    const chunks = await queue.all();
    expect(chunks).toHaveLength(2);
    await expect(verifyChain(chunks)).resolves.toMatchObject({ ok: true, events: 2 });
  });

  it('sealing with nothing buffered does not create an empty chunk', async () => {
    await recorder.seal();
    expect(await queue.all()).toHaveLength(0);
  });

  it('continues the chain after a reload rather than starting again', async () => {
    await recorder.recordEdit('p1', edit());
    await recorder.seal();

    // Same database, new objects, as a page reload would produce.
    const resumed = new Recorder({ sessionId: 'round1', participantId: 'kowalski', queue });
    await resumed.recordEdit('p1', edit({ at: 5 }));
    await resumed.seal();

    await expect(verifyChain(await queue.all())).resolves.toMatchObject({ ok: true, chunks: 2 });
  });
});

describe('paste provenance', () => {
  it('records a paste alongside the edit', async () => {
    await recorder.recordEdit('p1', edit({ inserted: 'hello', source: 'paste' }));
    await recorder.seal();
    const events = (await queue.all()).flatMap((chunk) => chunk.events);
    expect(events.map((e) => e.t)).toEqual(['edit', 'paste']);
  });

  it('treats a drop the same as a paste, since it is the same hole', async () => {
    await recorder.recordEdit('p1', edit({ inserted: 'hello', source: 'drop' }));
    await recorder.seal();
    const events = (await queue.all()).flatMap((chunk) => chunk.events);
    expect(events.some((e) => e.t === 'paste')).toBe(true);
  });

  it('marks text that never existed in the session as novel', async () => {
    recorder.noteDocument('p1', 'int main() {}');
    await recorder.recordEdit(
      'p1',
      edit({ inserted: 'a completely new solution', source: 'paste' }),
    );
    await recorder.seal();
    const paste = (await queue.all()).flatMap((c) => c.events).find((e) => e.t === 'paste');
    expect(paste).toMatchObject({ novel: true });
  });

  it('judges novelty before the edit lands, not after', async () => {
    // The bug this guards: if the tracked text is updated first, the pasted text is
    // already present when the question is asked and every paste looks familiar.
    recorder.noteDocument('p1', '');
    await recorder.recordEdit('p1', edit({ inserted: 'brand new text', source: 'paste' }));
    await recorder.seal();
    const paste = (await queue.all()).flatMap((c) => c.events).find((e) => e.t === 'paste');
    expect(paste).toMatchObject({ novel: true });
  });

  it('recognises text it saw arrive earlier in the same problem', async () => {
    recorder.noteDocument('p1', '');
    await recorder.recordEdit(
      'p1',
      edit({ inserted: 'int solve() { return 1; }', source: 'input' }),
    );
    await recorder.recordEdit(
      'p1',
      edit({ from: 25, to: 25, inserted: 'int solve()', source: 'paste' }),
    );
    await recorder.seal();
    const paste = (await queue.all()).flatMap((c) => c.events).find((e) => e.t === 'paste');
    expect(paste).toMatchObject({ novel: false });
  });

  it('does not flag moving your own code between problems', async () => {
    // The distinction that matters: everyone pastes their own work.
    recorder.noteDocument('p1', 'long long gcd(long long a, long long b);');
    await recorder.recordEdit(
      'p2',
      edit({ inserted: 'long long gcd(long long a', source: 'paste' }),
    );
    await recorder.seal();
    const paste = (await queue.all()).flatMap((c) => c.events).find((e) => e.t === 'paste');
    expect(paste).toMatchObject({ novel: false });
  });

  it('keeps the text only for insertions large enough to matter', async () => {
    await recorder.recordEdit('p1', edit({ inserted: 'short', source: 'paste' }));
    await recorder.recordEdit(
      'p1',
      edit({ inserted: 'y'.repeat(PASTE_TEXT_THRESHOLD), source: 'paste' }),
    );
    await recorder.seal();

    const pastes = (await queue.all()).flatMap((c) => c.events).filter((e) => e.t === 'paste');
    expect(pastes[0]).not.toHaveProperty('text');
    expect(pastes[1]).toHaveProperty('text');
    // The small one still carries a hash and a length, so it is not invisible.
    expect(pastes[0]).toMatchObject({ len: 5, hash: expect.any(String) });
  });

  it('does not record a paste event for ordinary typing', async () => {
    await recorder.recordEdit('p1', edit({ inserted: 'a', source: 'input' }));
    await recorder.seal();
    const events = (await queue.all()).flatMap((c) => c.events);
    expect(events.filter((e) => e.t === 'paste')).toHaveLength(0);
  });
});

describe('sealing under load', () => {
  it('seals early rather than batching a busy session late', async () => {
    const eager = new Recorder({
      sessionId: 'round1',
      participantId: 'kowalski',
      queue,
      chunkMaxEvents: 3,
    });
    for (let i = 0; i < 3; i++) eager.record({ t: 'beat', at: i });
    await eager.seal();
    expect((await queue.all()).length).toBeGreaterThanOrEqual(1);
  });

  it('produces a chain that verifies when seals overlap', async () => {
    // Two seals racing for one sequence number would make the chain unverifiable.
    for (let i = 0; i < 20; i++) recorder.record({ t: 'beat', at: i });
    await Promise.all([recorder.seal(), recorder.seal(), recorder.seal()]);
    await expect(verifyChain(await queue.all())).resolves.toMatchObject({ ok: true });
  });
});
