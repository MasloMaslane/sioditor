import type { SessionChunk } from './chain.js';
import type { Transport } from './sync.js';

/**
 * Delivers chunks over HTTP.
 *
 * Two things it deliberately does not do. It does not treat a 4xx as retryable - a body
 * the server will never accept would otherwise be retried until the round ends - and it
 * does not swallow failures, because the sync loop needs them to back off.
 */
export class HttpTransport implements Transport {
  constructor(
    private readonly endpoint: string,
    private readonly sessionId: string,
    private readonly participantId: string,
  ) {}

  async send(chunks: readonly SessionChunk[]): Promise<readonly number[]> {
    const response = await fetch(`${this.endpoint}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: this.body(chunks),
      keepalive: false,
    });

    if (response.status >= 400 && response.status < 500) {
      // Report it as accepted rather than retrying forever: the server has told us it
      // will never take this, and blocking the queue behind it would lose the rest.
      console.error(`ingest rejected ${response.status}`, await response.text().catch(() => ''));
      return chunks.map((chunk) => chunk.seq);
    }
    if (!response.ok) throw new Error(`ingest failed: ${response.status}`);

    const body = (await response.json()) as { accepted?: number[] };
    return body.accepted ?? [];
  }

  /**
   * A last attempt as the page goes away.
   *
   * sendBeacon survives teardown where fetch does not, but gives no acknowledgement - so
   * chunks stay pending and are re-sent next time. The server's idempotency is what makes
   * that safe.
   */
  beacon(chunks: readonly SessionChunk[]): boolean {
    if (chunks.length === 0 || typeof navigator === 'undefined' || !navigator.sendBeacon) {
      return false;
    }
    return navigator.sendBeacon(
      `${this.endpoint}/api/ingest`,
      new Blob([this.body(chunks)], { type: 'application/json' }),
    );
  }

  private body(chunks: readonly SessionChunk[]): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      participantId: this.participantId,
      chunks,
    });
  }
}
