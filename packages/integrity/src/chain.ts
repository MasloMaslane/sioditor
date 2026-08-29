import type { IntegrityEvent } from './events.js';

/**
 * A batch of events, linked to the one before it.
 *
 * The chain is not a guarantee of honesty - the recorder is JavaScript on the
 * contestant's machine and can be switched off. It makes *interference visible*: a
 * missing sequence number, or a chunk whose hash does not follow from its predecessor,
 * means the record cannot be trusted. That distinction matters, because "unverifiable"
 * and "clean" must never be reported as the same thing.
 */
export interface SessionChunk {
  readonly sessionId: string;
  readonly participantId: string;
  /** Monotonic from 0. Gaps are the point. */
  readonly seq: number;
  /** Hash of the previous chunk, or the empty string for the first. */
  readonly prevHash: string;
  readonly hash: string;
  readonly events: readonly IntegrityEvent[];
}

const encoder = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content hash of a text, used for paste provenance. */
export const hashText = sha256;

/** The canonical form a chunk's hash is taken over. Field order is part of the format. */
function canonical(chunk: Omit<SessionChunk, 'hash'>): string {
  return JSON.stringify({
    sessionId: chunk.sessionId,
    participantId: chunk.participantId,
    seq: chunk.seq,
    prevHash: chunk.prevHash,
    events: chunk.events,
  });
}

export async function sealChunk(chunk: Omit<SessionChunk, 'hash'>): Promise<SessionChunk> {
  return { ...chunk, hash: await sha256(canonical(chunk)) };
}

export type ChainVerdict =
  | { readonly ok: true; readonly chunks: number; readonly events: number }
  | { readonly ok: false; readonly reason: string; readonly atSeq: number };

/**
 * Checks a session's chunks end to end.
 *
 * Answers three separate questions - is anything missing, has anything been rewritten,
 * and do the chunks belong together - and names which one failed, because a reviewer
 * needs to know whether they are looking at a gap or at an alteration.
 */
export async function verifyChain(chunks: readonly SessionChunk[]): Promise<ChainVerdict> {
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);
  let previous = '';
  let events = 0;

  for (const [index, chunk] of ordered.entries()) {
    if (chunk.seq !== index) {
      return { ok: false, reason: `missing chunk ${index}`, atSeq: index };
    }
    if (chunk.prevHash !== previous) {
      return { ok: false, reason: 'chunk does not follow its predecessor', atSeq: chunk.seq };
    }
    const expected = await sha256(canonical(chunk));
    if (expected !== chunk.hash) {
      return { ok: false, reason: 'chunk contents were altered', atSeq: chunk.seq };
    }
    previous = chunk.hash;
    events += chunk.events.length;
  }

  return { ok: true, chunks: ordered.length, events };
}
