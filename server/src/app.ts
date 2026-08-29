import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { verifyChain, type SessionChunk } from '@sioditor/integrity';
import { SessionStore } from './store.js';

export interface ServerOptions {
  readonly store: SessionStore;
  /** Shared secret an organiser presents to read recordings. Reads are open without it. */
  readonly reviewToken?: string;
  /** Largest ingest body accepted, in bytes. */
  readonly maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 8 * 1024 * 1024;

interface IngestBody {
  sessionId?: unknown;
  participantId?: unknown;
  chunks?: unknown;
}

/**
 * The ingest and review endpoints.
 *
 * Built on node:http with no framework: it does four things, it has to be trivial for an
 * organiser to run, and every dependency is something that has to be kept patched on a
 * machine holding contest data.
 */
export function createApp(options: ServerOptions) {
  const { store } = options;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return createServer((request, response) => {
    handle(request, response).catch((cause) => {
      // A failure here must not be silent: the client would retry forever against a
      // server that is answering, which looks like a network problem and is not.
      console.error('request failed', cause);
      send(response, 500, { error: 'internal error' });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    // The editor may be served from a different origin during development.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    if (url.pathname === '/health') {
      send(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/ingest') {
      await ingest(request, response);
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/sessions')) {
      if (!authorised(request)) {
        send(response, 401, { error: 'a review token is required' });
        return;
      }
      await review(url, response);
      return;
    }

    send(response, 404, { error: 'no such endpoint' });
  }

  function authorised(request: IncomingMessage): boolean {
    if (!options.reviewToken) return true;
    return request.headers.authorization === `Bearer ${options.reviewToken}`;
  }

  async function ingest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: IngestBody;
    try {
      body = JSON.parse(await readBody(request, maxBody)) as IngestBody;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'unreadable body';
      // 400 rather than 500: the client must not retry a body the server will never
      // accept, or it will retry it until the round ends.
      send(response, 400, { error: message });
      return;
    }

    const { sessionId, participantId, chunks } = body;
    if (typeof sessionId !== 'string' || typeof participantId !== 'string') {
      send(response, 400, { error: 'sessionId and participantId are required' });
      return;
    }
    if (!Array.isArray(chunks)) {
      send(response, 400, { error: 'chunks must be an array' });
      return;
    }

    try {
      const accepted = await store.append(sessionId, participantId, chunks as SessionChunk[]);
      send(response, 200, { accepted });
    } catch (cause) {
      send(response, 400, { error: cause instanceof Error ? cause.message : 'rejected' });
    }
  }

  async function review(url: URL, response: ServerResponse): Promise<void> {
    const parts = url.pathname.split('/').filter(Boolean).slice(2);

    if (parts.length === 0) {
      send(response, 200, { sessions: await store.sessions() });
      return;
    }

    const [sessionId, participantId] = parts;
    if (!participantId) {
      const participants = await store.participants(sessionId!);
      const summaries = await Promise.all(
        participants.map(async (id) => {
          const chunks = await store.read(sessionId!, id);
          return {
            participantId: id,
            chunks: chunks.length,
            events: chunks.reduce((sum, chunk) => sum + chunk.events.length, 0),
            // Reported per participant so a broken record is visible in the list, not
            // only once somebody opens it.
            chain: await verifyChain(chunks),
          };
        }),
      );
      send(response, 200, { sessionId, participants: summaries });
      return;
    }

    const chunks = await store.read(sessionId!, participantId);
    send(response, 200, { sessionId, participantId, chain: await verifyChain(chunks), chunks });
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => {
      size += part.byteLength;
      if (size > limit) {
        reject(new Error(`body larger than ${limit} bytes`));
        request.destroy();
        return;
      }
      parts.push(part);
    });
    request.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    request.on('error', reject);
  });
}
