import { useRef, useState } from 'react';
import { exportWorkspace, importWorkspace, type Language, type Problem } from '@sioditor/storage';
import type { WorkspaceState } from './useWorkspace.js';

const LANGUAGE_LABEL: Record<Language, string> = { cpp: 'C++', python: 'Py' };

/**
 * The list of open problems.
 *
 * A contestant juggles several tasks in a round, so switching has to be one click and
 * lose nothing. Rename is inline because the default names are placeholders.
 */
export function ProblemList({ workspace }: { workspace: WorkspaceState }) {
  const [renaming, setRenaming] = useState<string>();
  const filePicker = useRef<HTMLInputElement>(null);

  const onExport = () => {
    const archive = exportWorkspace(workspace.problems);
    // A Blob URL rather than a data: URL - a workspace with a few problems and their
    // tests comfortably exceeds what some browsers accept in a data: URL.
    const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sioditor-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    const archive = new Uint8Array(await file.arrayBuffer());
    // Added alongside what is already open rather than replacing it: an import that
    // silently wiped a workspace mid-contest would be unforgivable.
    for (const problem of importWorkspace(archive)) workspace.add(problem);
  };

  const onRename = (problem: Problem, name: string) => {
    setRenaming(undefined);
    const trimmed = name.trim();
    if (trimmed && trimmed !== problem.name) workspace.rename(problem.id, trimmed);
  };

  return (
    <nav className="problems">
      <div className="problems-head">
        <span className="panel-title">Zadania</span>
        <div className="problems-add">
          {(['python', 'cpp'] as const).map((language) => (
            <button
              key={language}
              title={`Nowe zadanie (${LANGUAGE_LABEL[language]})`}
              onClick={() => workspace.create(language)}
            >
              + {LANGUAGE_LABEL[language]}
            </button>
          ))}
        </div>
      </div>

      <ul>
        {workspace.problems.map((problem) => (
          <li key={problem.id} className={problem.id === workspace.current?.id ? 'active' : ''}>
            {renaming === problem.id ? (
              <input
                autoFocus
                defaultValue={problem.name}
                onBlur={(event) => onRename(problem, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setRenaming(undefined);
                }}
              />
            ) : (
              <button
                className="problem-open"
                onClick={() => workspace.select(problem.id)}
                onDoubleClick={() => setRenaming(problem.id)}
                title="Kliknij dwukrotnie, aby zmienic nazwe"
              >
                <span className="problem-lang">{LANGUAGE_LABEL[problem.language]}</span>
                <span className="problem-name">{problem.name}</span>
              </button>
            )}
            <button
              className="problem-remove"
              title="Usun zadanie"
              onClick={() => workspace.remove(problem.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="problems-foot">
        <button onClick={onExport} title="Pobierz wszystkie zadania jako .zip">
          Eksport
        </button>
        <button onClick={() => filePicker.current?.click()} title="Wczytaj zadania z .zip">
          Import
        </button>
        <input
          ref={filePicker}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onImport(file);
            event.target.value = '';
          }}
        />
      </div>
    </nav>
  );
}
