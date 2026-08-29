import { describe, expect, it } from 'vitest';
import { sealChunk, verifyChain, type SessionChunk } from '../src/chain.js';
import type { IntegrityEvent } from '../src/events.js';

const beat = (at: number): IntegrityEvent => ({ t: 'beat', at });

async function buildChain(count: number): Promise<SessionChunk[]> {
  const chunks: SessionChunk[] = [];
  let prevHash = '';
  for (let seq = 0; seq < count; seq++) {
    const chunk = await sealChunk({
      sessionId: 's1',
      participantId: 'p1',
      seq,
      prevHash,
      events: [beat(seq * 1000)],
    });
    chunks.push(chunk);
    prevHash = chunk.hash;
  }
  return chunks;
}

describe('chain verification', () => {
  it('accepts an intact chain', async () => {
    await expect(verifyChain(await buildChain(4))).resolves.toEqual({
      ok: true,
      chunks: 4,
      events: 4,
    });
  });

  it('accepts chunks that arrived out of order', async () => {
    // Delivery order says nothing about the record; only seq does.
    const chunks = await buildChain(4);
    const shuffled = [chunks[2]!, chunks[0]!, chunks[3]!, chunks[1]!];
    await expect(verifyChain(shuffled)).resolves.toMatchObject({ ok: true });
  });

  it('names a missing chunk rather than reporting the session clean', async () => {
    const chunks = await buildChain(4);
    const result = await verifyChain([chunks[0]!, chunks[1]!, chunks[3]!]);
    expect(result).toMatchObject({ ok: false, atSeq: 2 });
    expect(result.ok === false && result.reason).toMatch(/missing/);
  });

  it('detects an event edited after the fact', async () => {
    const chunks = await buildChain(3);
    const tampered = { ...chunks[1]!, events: [beat(999_999)] };
    const result = await verifyChain([chunks[0]!, tampered, chunks[2]!]);
    expect(result).toMatchObject({ ok: false, atSeq: 1 });
    expect(result.ok === false && result.reason).toMatch(/altered/);
  });

  it('detects a chunk resealed to hide the alteration', async () => {
    // Rewriting the contents and re-hashing produces a chunk that is internally
    // consistent; the link to its predecessor is what gives it away.
    const chunks = await buildChain(3);
    const resealed = await sealChunk({
      sessionId: 's1',
      participantId: 'p1',
      seq: 1,
      prevHash: 'something else',
      events: [beat(999_999)],
    });
    const result = await verifyChain([chunks[0]!, resealed, chunks[2]!]);
    expect(result).toMatchObject({ ok: false, atSeq: 1 });
    expect(result.ok === false && result.reason).toMatch(/predecessor/);
  });

  it('an empty session is intact, not broken', async () => {
    await expect(verifyChain([])).resolves.toEqual({ ok: true, chunks: 0, events: 0 });
  });
});
