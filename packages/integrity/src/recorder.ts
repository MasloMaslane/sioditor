import { hashText, sealChunk } from './chain.js';
import { HEARTBEAT_MS, PASTE_TEXT_THRESHOLD, type IntegrityEvent } from './events.js';
import type { ChunkQueue } from './queue.js';

export interface RecorderOptions {
  readonly sessionId: string;
  readonly participantId: string;
  readonly queue: ChunkQueue;
  /** How long events accumulate before being sealed into a chunk. */
  readonly chunkIntervalMs?: number;
  /** Seal early once this many events are held, so a busy session is not batched late. */
  readonly chunkMaxEvents?: number;
  readonly onChunkSealed?: () => void;
}

const DEFAULTS = { chunkIntervalMs: 10_000, chunkMaxEvents: 200 };

/**
 * Collects what a supervised session records.
 *
 * Buffers events, seals them into hash-chained chunks, and hands them to the queue.
 * Delivery is somebody else's problem by design: the recorder must not care whether the
 * network exists, so that losing it costs nothing.
 */
export class Recorder {
  private buffer: IntegrityEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private sealing: Promise<unknown> = Promise.resolve();
  /**
   * The text of each problem, maintained by applying the edits as they are recorded.
   *
   * Kept here rather than pushed in from the editor because of ordering: the editor's
   * change callback fires for the same update, so a document updated from outside already
   * contains the pasted text by the time novelty is judged, and every paste looks
   * familiar. Applying the edit *after* the check is the only way to ask the question at
   * the right moment.
   *
   * It answers "did this text already exist in the work" - copying between one's own
   * problems, or re-pasting a block from higher up the file. It is not an attempt to
   * prove where text came from, which a browser cannot do.
   */
  private documents = new Map<string, string>();

  constructor(private readonly options: RecorderOptions) {}

  start(phase: 'start' | 'resume' = 'start'): void {
    const { chunkIntervalMs } = { ...DEFAULTS, ...this.options };
    this.record({ t: 'session', at: Date.now(), phase });
    this.timer ??= setInterval(() => void this.seal(), chunkIntervalMs);
    this.heartbeat ??= setInterval(() => this.record({ t: 'beat', at: Date.now() }), HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.timer = undefined;
    this.heartbeat = undefined;
    await this.seal();
  }

  /**
   * Seeds a problem's text - on opening one, or on restoring a session.
   *
   * Not called for every keystroke: the recorder keeps the text current itself.
   */
  noteDocument(problemId: string, source: string): void {
    this.documents.set(problemId, source);
  }

  record(event: IntegrityEvent): void {
    this.buffer.push(event);
    const { chunkMaxEvents } = { ...DEFAULTS, ...this.options };
    if (this.buffer.length >= chunkMaxEvents) void this.seal();
  }

  async recordEdit(
    problemId: string,
    edit: { at: number; from: number; to: number; inserted: string; source: string },
  ): Promise<void> {
    const src = edit.source as 'input' | 'paste' | 'drop' | 'undo' | 'program';
    this.record({
      t: 'edit',
      at: edit.at,
      problemId,
      from: edit.from,
      to: edit.to,
      len: edit.inserted.length,
      src,
    });

    // Large arrivals are the ones worth a reviewer's time, whether pasted or dropped.
    // Judged before the edit is applied, or the text would always appear familiar.
    if ((src === 'paste' || src === 'drop') && edit.inserted.length > 0) {
      const existing = [...this.documents.values()];
      const novel = !existing.some((document) => document.includes(edit.inserted));
      this.record({
        t: 'paste',
        at: edit.at,
        problemId,
        len: edit.inserted.length,
        hash: await hashText(edit.inserted),
        novel,
        ...(edit.inserted.length >= PASTE_TEXT_THRESHOLD ? { text: edit.inserted } : {}),
      });
    }

    this.applyEdit(problemId, edit);
  }

  /** Keeps the tracked text in step with the editor, after novelty has been judged. */
  private applyEdit(problemId: string, edit: { from: number; to: number; inserted: string }): void {
    const current = this.documents.get(problemId) ?? '';
    const from = Math.max(0, Math.min(edit.from, current.length));
    const to = Math.max(from, Math.min(edit.to, current.length));
    this.documents.set(problemId, current.slice(0, from) + edit.inserted + current.slice(to));
  }

  /**
   * Seals whatever is buffered into a chunk.
   *
   * Serialised against itself: two concurrent seals would race for the same sequence
   * number and produce a chain that cannot be verified.
   */
  async seal(): Promise<void> {
    this.sealing = this.sealing.then(async () => {
      if (this.buffer.length === 0) return;
      const events = this.buffer;
      this.buffer = [];

      const { queue, sessionId, participantId } = this.options;
      const chunk = await sealChunk({
        sessionId,
        participantId,
        seq: await queue.nextSeq(),
        prevHash: await queue.lastHash(),
        events,
      });
      await queue.append(chunk);
      this.options.onChunkSealed?.();
    });
    await this.sealing;
  }

  get buffered(): number {
    return this.buffer.length;
  }
}
