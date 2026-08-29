import { EditorView } from '@codemirror/view';
import type { Transaction } from '@codemirror/state';

/**
 * A single change to the document.
 *
 * This is the substrate the later integrity work needs - a delta log replays a session
 * keystroke by keystroke at tens of KB per hour, where screen capture costs tens of MB
 * and shows a reviewer less. Nothing is transmitted here; the editor only emits.
 */
export interface EditEvent {
  readonly at: number;
  readonly from: number;
  readonly to: number;
  readonly inserted: string;
  /** How the text arrived. `paste` and `drop` are the ones worth a second look. */
  readonly source: EditSource;
}

export type EditSource = 'input' | 'paste' | 'drop' | 'undo' | 'program';

function sourceOf(transaction: Transaction): EditSource {
  if (transaction.isUserEvent('input.paste')) return 'paste';
  if (transaction.isUserEvent('input.drop')) return 'drop';
  if (transaction.isUserEvent('undo') || transaction.isUserEvent('redo')) return 'undo';
  if (transaction.isUserEvent('input') || transaction.isUserEvent('delete')) return 'input';
  return 'program';
}

/** Emits one EditEvent per change range. */
export function editEventTap(onEdit: (event: EditEvent) => void) {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    for (const transaction of update.transactions) {
      if (!transaction.docChanged) continue;
      const source = sourceOf(transaction);
      const at = Date.now();
      transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        onEdit({ at, from: fromA, to: toA, inserted: inserted.toString(), source });
      });
    }
  });
}
