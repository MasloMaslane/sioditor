import { useCallback, useEffect, useRef, useState } from 'react';
import { Workspace, type Language, type Problem } from '@sioditor/storage';

export const STARTERS: Record<Language, string> = {
  python: `import sys

data = sys.stdin.read().split()
if data:
    print(sum(int(x) for x in data))
else:
    print("podaj liczby na wejsciu")
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    long long x, total = 0;
    while (cin >> x) total += x;
    cout << total << '\\n';
}
`,
};

const newProblem = (name: string, language: Language): Problem => ({
  id: crypto.randomUUID(),
  name,
  language,
  source: STARTERS[language],
  stdin: '1 2 3 4',
  timeLimitMs: 5000,
  memoryLimitBytes: 256 * 1024 * 1024,
  updatedAt: Date.now(),
});

/** Debounce for autosave. Long enough not to thrash IndexedDB, short enough to be safe. */
const AUTOSAVE_MS = 800;

export interface WorkspaceState {
  readonly problems: readonly Problem[];
  readonly current: Problem | undefined;
  readonly loaded: boolean;
  readonly select: (id: string) => void;
  readonly update: (patch: Partial<Problem>) => void;
  readonly create: (language: Language) => void;
  readonly rename: (id: string, name: string) => void;
  readonly remove: (id: string) => void;
}

/**
 * Keeps the open problem and the problem list in IndexedDB.
 *
 * Everything is written back on a short debounce rather than on an explicit save: during a
 * contest nobody remembers to press save, and losing a solution to a closed tab is the
 * worst thing this tool could do.
 */
export function useWorkspace(): WorkspaceState {
  const workspace = useRef(new Workspace());
  const [problems, setProblems] = useState<Problem[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await workspace.current.list();
      if (cancelled) return;
      if (existing.length === 0) {
        const first = newProblem('Zadanie 1', 'python');
        await workspace.current.save(first);
        setProblems([first]);
        setCurrentId(first.id);
      } else {
        setProblems(existing);
        setCurrentId(existing[0]!.id);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = problems.find((p) => p.id === currentId);

  const persist = useCallback((problem: Problem) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void workspace.current.save(problem);
      void workspace.current.recordRevision(problem.id, problem.source);
    }, AUTOSAVE_MS);
  }, []);

  const update = useCallback(
    (patch: Partial<Problem>) => {
      setProblems((prev) => {
        const next = prev.map((p) =>
          p.id === currentId ? { ...p, ...patch, updatedAt: Date.now() } : p,
        );
        const changed = next.find((p) => p.id === currentId);
        if (changed) persist(changed);
        return next;
      });
    },
    [currentId, persist],
  );

  const create = useCallback((language: Language) => {
    setProblems((prev) => {
      const problem = newProblem(`Zadanie ${prev.length + 1}`, language);
      void workspace.current.save(problem);
      setCurrentId(problem.id);
      return [problem, ...prev];
    });
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setProblems((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p));
      const changed = next.find((p) => p.id === id);
      if (changed) void workspace.current.save(changed);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setProblems((prev) => {
      const next = prev.filter((p) => p.id !== id);
      void workspace.current.remove(id);
      // Never leave the workspace empty: an empty list has no useful UI.
      if (next.length === 0) {
        const fresh = newProblem('Zadanie 1', 'python');
        void workspace.current.save(fresh);
        setCurrentId(fresh.id);
        return [fresh];
      }
      setCurrentId((currently) => (currently === id ? next[0]!.id : currently));
      return next;
    });
  }, []);

  return {
    problems,
    current,
    loaded,
    select: setCurrentId,
    update,
    create,
    rename,
    remove,
  };
}
