import { useState } from 'react';
import type { Language, Problem } from '@sioditor/storage';
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
    </nav>
  );
}
