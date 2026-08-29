import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { SessionStore } from '../src/store.js';
import { sealChunk, type SessionChunk } from '@sioditor/integrity';

let server: Server;
let base: string;
let root: string;

async function chunk(seq: number, prevHash = '', at = seq): Promise<SessionChunk> {
  return sealChunk({
    sessionId: 'round1',
    participantId: 'kowalski',
    seq,
    prevHash,
    events: [{ t: 'beat', at }],
  });
}

const ingest = (chunks: SessionChunk[], ids = {}) =>
  fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'round1',
      participantId: 'kowalski',
      chunks,
      ...ids,
    }),
  });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sioditor-'));
  server = createApp({ store: new SessionStore(root) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

describe('ingest', () => {
  it('accepts chunks and reports which it took', async () => {
    const response = await ingest([await chunk(0)]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: [0] });
  });

  it('is idempotent, because a lost acknowledgement means a resend', async () => {
    const one = await chunk(0);
    await ingest([one]);
    const again = await ingest([one]);

    // Acknowledged again rather than rejected: the client has to be able to stop
    // retrying, and the record must not gain a duplicate.
    await expect(again.json()).resolves.toEqual({ accepted: [0] });

    const store = new SessionStore(root);
    expect(await store.read('round1', 'kowalski')).toHaveLength(1);
  });

  it('accepts a backlog arriving at once after an outage', async () => {
    const a = await chunk(0);
    const b = await chunk(1, a.hash);
    const c = await chunk(2, b.hash);
    await expect((await ingest([a, b, c])).json()).resolves.toEqual({ accepted: [0, 1, 2] });
  });

  it('accepts chunks out of order and stores them in order', async () => {
    const a = await chunk(0);
    const b = await chunk(1, a.hash);
    await ingest([b]);
    await ingest([a]);
    const store = new SessionStore(root);
    expect((await store.read('round1', 'kowalski')).map((c) => c.seq)).toEqual([0, 1]);
  });

  it('rejects an unusable body with 400, so the client stops retrying it', async () => {
    const response = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects a missing participant', async () => {
    const response = await ingest([await chunk(0)], { participantId: undefined });
    expect(response.status).toBe(400);
  });

  it('refuses an id that would escape the data directory', async () => {
    const response = await ingest([await chunk(0)], { sessionId: '../../etc' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/id/) });
  });

  it('keeps participants separate', async () => {
    await ingest([await chunk(0)]);
    await ingest([await chunk(0)], { participantId: 'nowak' });
    const store = new SessionStore(root);
    expect(await store.participants('round1')).toHaveLength(2);
  });
});

describe('review', () => {
  it('summarises a session and reports each chain as intact', async () => {
    const a = await chunk(0);
    const b = await chunk(1, a.hash);
    await ingest([a, b]);

    const body = (await (await fetch(`${base}/api/sessions/round1`)).json()) as {
      participants: Array<{ participantId: string; events: number; chain: { ok: boolean } }>;
    };
    expect(body.participants).toHaveLength(1);
    expect(body.participants[0]).toMatchObject({
      participantId: 'kowalski',
      events: 2,
      chain: { ok: true },
    });
  });

  it('reports a gap rather than presenting the record as clean', async () => {
    const a = await chunk(0);
    const b = await chunk(1, a.hash);
    const c = await chunk(2, b.hash);
    // The middle chunk never made it - the client was closed before it could be sent.
    await ingest([a, c]);

    const body = (await (await fetch(`${base}/api/sessions/round1`)).json()) as {
      participants: Array<{ chain: { ok: boolean; reason?: string } }>;
    };
    expect(body.participants[0]!.chain.ok).toBe(false);
    expect(body.participants[0]!.chain.reason).toMatch(/missing/);
  });

  it('returns the chunks themselves for replay', async () => {
    await ingest([await chunk(0)]);
    const body = (await (await fetch(`${base}/api/sessions/round1/kowalski`)).json()) as {
      chunks: SessionChunk[];
    };
    expect(body.chunks).toHaveLength(1);
    expect(body.chunks[0]!.events[0]).toMatchObject({ t: 'beat' });
  });

  it('is empty rather than an error for a session nobody joined', async () => {
    const body = await (await fetch(`${base}/api/sessions/unknown`)).json();
    expect(body).toMatchObject({ participants: [] });
  });
});

describe('review access', () => {
  it('requires the token when one is configured, but ingest stays open', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createApp({ store: new SessionStore(root), reviewToken: 'secret' });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Contestants must be able to deliver without holding a reviewer credential.
    expect((await ingest([await chunk(0)])).status).toBe(200);
    expect((await fetch(`${base}/api/sessions/round1`)).status).toBe(401);

    const allowed = await fetch(`${base}/api/sessions/round1`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(allowed.status).toBe(200);
  });
});
