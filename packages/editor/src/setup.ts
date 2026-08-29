import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  bracketMatching,
  indentOnInput,
  foldGutter,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { editEventTap, type EditEvent } from './events.js';

export type Language = 'cpp' | 'python';

export interface EditorOptions {
  readonly parent: HTMLElement;
  readonly doc: string;
  readonly language: Language;
  readonly onChange?: (doc: string) => void;
  readonly onEdit?: (event: EditEvent) => void;
  /** Ctrl/Cmd+Enter. Wired here so it works regardless of focus. */
  readonly onRun?: () => void;
}

function languageExtension(language: Language): Extension {
  return language === 'cpp' ? cpp() : python();
}

function baseExtensions(options: EditorOptions): Extension[] {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    languageExtension(options.language),
  ];

  if (options.onRun) {
    const run = options.onRun;
    extensions.push(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            run();
            return true;
          },
        },
      ]),
    );
  }

  if (options.onChange) {
    const onChange = options.onChange;
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    );
  }

  if (options.onEdit) extensions.push(editEventTap(options.onEdit));

  return extensions;
}

export function createEditor(options: EditorOptions): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({ doc: options.doc, extensions: baseExtensions(options) }),
  });
}

/**
 * Swaps the whole state. Used when switching between problems, where the point is
 * precisely that undo history should not carry across.
 */
export function loadDocument(view: EditorView, options: EditorOptions): void {
  view.setState(EditorState.create({ doc: options.doc, extensions: baseExtensions(options) }));
}
