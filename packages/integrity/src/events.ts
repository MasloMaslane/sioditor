/**
 * What a supervised session records.
 *
 * Deliberately small. Every field here has to be defensible to a contestant reading the
 * notice, so anything that would not survive that question is absent: no keystroke
 * timings beyond the edit log's own timestamps, no window titles, no clipboard contents
 * below the paste threshold, nothing about other origins.
 */
export type IntegrityEvent =
  /** One change to the document. Enough, in sequence, to replay the session. */
  | {
      readonly t: 'edit';
      readonly at: number;
      readonly problemId: string;
      readonly from: number;
      readonly to: number;
      readonly len: number;
      readonly src: 'input' | 'paste' | 'drop' | 'undo' | 'program';
    }
  /**
   * An insertion large enough to be worth a reviewer's attention.
   *
   * `novel` is the question that matters: not "did they paste" - everyone pastes their
   * own code - but "did text arrive that this session has never seen". `text` is carried
   * only above the threshold, so an ordinary session holds no copy of the work.
   */
  | {
      readonly t: 'paste';
      readonly at: number;
      readonly problemId: string;
      readonly len: number;
      readonly hash: string;
      readonly novel: boolean;
      readonly text?: string;
    }
  | { readonly t: 'focus'; readonly at: number; readonly visible: boolean }
  | { readonly t: 'fullscreen'; readonly at: number; readonly active: boolean }
  /** More than one tab of this origin open. Says nothing about other origins. */
  | { readonly t: 'tabs'; readonly at: number; readonly count: number }
  | {
      readonly t: 'run';
      readonly at: number;
      readonly problemId: string;
      readonly language: string;
      readonly outcome: string;
    }
  /** Periodic, so a silent gap is distinguishable from a session that simply paused. */
  | { readonly t: 'beat'; readonly at: number }
  | { readonly t: 'session'; readonly at: number; readonly phase: 'start' | 'resume' };

/** Insertions at or above this many characters carry their text. */
export const PASTE_TEXT_THRESHOLD = 120;

/** How often a heartbeat is emitted while the page is open. */
export const HEARTBEAT_MS = 30_000;
