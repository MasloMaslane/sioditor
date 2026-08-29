import type { SessionChunk } from './chain.js';

/**
 * The part of the queue delivery needs.
 *
 * An interface rather than the concrete ChunkQueue so the loop can be exercised against
 * an in-memory store: timing behaviour and storage are separate concerns, and testing
 * backoff should not require driving IndexedDB.
 */
export interface ChunkStore {
  pending(limit?: number): Promise<SessionChunk[]>;
  markDelivered(seqs: readonly number[]): Promise<void>;
  pendingCount(): Promise<number>;
}

export interface Transport {
  /**
   * Delivers chunks. Resolves with the sequence numbers the server accepted.
   *
   * Must be idempotent at the server: a chunk whose acknowledgement was lost will be sent
   * again, and re-sending must not create a duplicate or an error.
   */
  send(chunks: readonly SessionChunk[]): Promise<readonly number[]>;
}

export interface SyncOptions {
  readonly queue: ChunkStore;
  readonly transport: Transport;
  /** Delay after the first failure. Doubles per consecutive failure, up to the cap. */
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Steady-state interval between flushes when everything is healthy. */
  readonly intervalMs?: number;
  readonly onStateChange?: (state: SyncState) => void;
}

export interface SyncState {
  /** Chunks recorded but not yet acknowledged. */
  readonly pending: number;
  /** Consecutive failed attempts. Zero once a flush succeeds. */
  readonly failures: number;
  readonly lastError: string | undefined;
  readonly lastDeliveredAt: number | undefined;
}

const DEFAULTS = { baseDelayMs: 1_000, maxDelayMs: 60_000, intervalMs: 5_000 };

/**
 * Ships recorded chunks to the server, and keeps going when it cannot.
 *
 * The contract this exists to hold: **no recorded event is ever lost because of the
 * network.** Chunks are on disk before a send is attempted and are only marked delivered
 * on acknowledgement, so a failure at any point - offline client, dead server, a response
 * that never arrives - costs a retry and nothing else.
 *
 * Backoff is exponential with a cap rather than a fixed retry, because the realistic
 * failure during a contest is the server being down for minutes: hammering it every
 * second helps nobody and a one-minute ceiling means recovery is still prompt.
 */
export class SyncLoop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inFlight = false;
  private failures = 0;
  private lastError: string | undefined;
  private lastDeliveredAt: number | undefined;

  constructor(private readonly options: SyncOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delay: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private get settings() {
    return { ...DEFAULTS, ...this.options };
  }

  /**
   * Attempts one delivery.
   *
   * Safe to call at any time - on a timer, when the page is hidden, when connectivity
   * returns - because an attempt already in flight is not duplicated.
   */
  async flush(): Promise<void> {
    if (this.inFlight) return;
    const { queue, transport } = this.options;
    const { baseDelayMs, maxDelayMs, intervalMs } = this.settings;

    this.inFlight = true;
    try {
      const pending = await queue.pending();
      if (pending.length === 0) {
        this.failures = 0;
        this.lastError = undefined;
        await this.report();
        this.schedule(intervalMs);
        return;
      }

      const accepted = await transport.send(pending);
      await queue.markDelivered(accepted);
      this.failures = 0;
      this.lastError = undefined;
      this.lastDeliveredAt = Date.now();
      await this.report();

      // More waiting? Come straight back rather than idling a full interval.
      const remaining = await queue.pendingCount();
      this.schedule(remaining > 0 ? 0 : intervalMs);
    } catch (cause) {
      this.failures++;
      this.lastError = cause instanceof Error ? cause.message : String(cause);
      await this.report();
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (this.failures - 1));
      this.schedule(delay);
    } finally {
      this.inFlight = false;
    }
  }

  private async report(): Promise<void> {
    const onStateChange = this.options.onStateChange;
    if (!onStateChange) return;
    onStateChange({
      pending: await this.options.queue.pendingCount(),
      failures: this.failures,
      lastError: this.lastError,
      lastDeliveredAt: this.lastDeliveredAt,
    });
  }
}
