import { useCallback, useEffect } from 'react';
import type { Language } from '@sioditor/editor';
import { PACKS, PackManager, getPack, requestPersistence, testsOf } from '@sioditor/storage';
import type { TestCase } from '@sioditor/storage';
import { Editor } from './Editor.js';
import { ProblemList } from './ProblemList.js';
import { TestPanel } from './TestPanel.js';
import { PackBar } from './PackBar.js';
import { usePack } from './usePack.js';
import { useRun } from './useRun.js';
import { STARTERS, useWorkspace } from './useWorkspace.js';

const packs = new PackManager();

export function App() {
  const workspace = useWorkspace();
  const current = workspace.current;
  const language: Language = current?.language ?? 'python';
  const runner = useRun();

  const pythonPack = usePack(packs, getPack('python'));
  const numpyPack = usePack(packs, getPack('numpy'));
  const cppPack = usePack(packs, getPack('cpp'));
  const activePack = language === 'cpp' ? cppPack : pythonPack;

  useEffect(() => {
    void requestPersistence();
  }, []);

  // Results belong to the problem that produced them.
  useEffect(() => {
    runner.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const cases = current ? testsOf(current) : [];

  const switchLanguage = useCallback(
    (next: Language) => {
      if (!current || current.language === next) return;
      // The source belongs to a language, so both change together.
      workspace.update({ language: next, source: STARTERS[next] });
      runner.clear();
    },
    [current, runner, workspace],
  );

  const onRun = useCallback(() => {
    if (!current) return;
    if (!activePack.ready) {
      return;
    }
    void runner.run(current, cases);
  }, [activePack.ready, cases, current, runner]);

  if (!workspace.loaded) {
    return <div className="app loading">Wczytywanie...</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">sioditor</span>
        <div className="langs">
          {(['python', 'cpp'] as const).map((lang) => (
            <button
              key={lang}
              className={lang === language ? 'active' : ''}
              onClick={() => switchLanguage(lang)}
            >
              {lang === 'cpp' ? 'C++' : 'Python'}
            </button>
          ))}
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={onRun}
            disabled={runner.running || !activePack.checked || !activePack.ready}
            title={activePack.ready ? 'Ctrl+Enter' : 'Najpierw pobierz pakiet'}
          >
            Uruchom wszystkie
          </button>
          <button onClick={runner.stop} disabled={!runner.running}>
            Zatrzymaj
          </button>
        </div>
      </header>

      {PACKS.filter(
        (pack) => pack.id === activePack.pack.id || (language === 'python' && pack.id === 'numpy'),
      ).map((pack) => (
        <PackBar key={pack.id} pack={pack.id === 'numpy' ? numpyPack : activePack} />
      ))}

      <main className="workspace">
        <ProblemList workspace={workspace} />

        <Editor
          key={current?.id ?? 'none'}
          doc={current?.source ?? ''}
          language={language}
          onChange={(next) => workspace.update({ source: next })}
          onRun={onRun}
        />

        <aside className="side">
          <TestPanel
            cases={cases}
            results={runner.results}
            onChange={(next: readonly TestCase[]) => workspace.update({ tests: next })}
          />
          {(runner.buildOutput || runner.status) && (
            <div className="panel build">
              <span className="panel-title">Kompilacja</span>
              {runner.buildOutput && <pre>{runner.buildOutput}</pre>}
              {runner.status && <span className="status">{runner.status}</span>}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
