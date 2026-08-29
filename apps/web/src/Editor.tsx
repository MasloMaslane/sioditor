import { useEffect, useRef } from 'react';
import {
  createEditor,
  loadDocument,
  type EditEvent,
  type EditorView,
  type Language,
} from '@sioditor/editor';

interface EditorProps {
  doc: string;
  language: Language;
  onChange: (doc: string) => void;
  onEdit?: (event: EditEvent) => void;
  onRun?: () => void;
}

export function Editor({ doc, language, onChange, onEdit, onRun }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);

  // Callbacks are read through a ref so that a re-render does not tear down and rebuild
  // the editor state - that would throw away undo history on every keystroke.
  const handlers = useRef({ onChange, onEdit, onRun });
  handlers.current = { onChange, onEdit, onRun };

  useEffect(() => {
    if (!host.current) return;
    const options = {
      parent: host.current,
      doc,
      language,
      onChange: (next: string) => handlers.current.onChange(next),
      onEdit: (event: EditEvent) => handlers.current.onEdit?.(event),
      onRun: () => handlers.current.onRun?.(),
    };

    if (view.current) {
      loadDocument(view.current, options);
    } else {
      view.current = createEditor(options);
    }
    // `doc` is intentionally excluded: it is the initial value for this language, and
    // reloading on every edit would fight the editor for control of the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => () => view.current?.destroy(), []);

  return <div className="editor" ref={host} />;
}
