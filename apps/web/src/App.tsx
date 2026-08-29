import { useCallback, useEffect, useState } from 'react';
import type { Language } from '@sioditor/editor';
import { PACKS, PackManager, getPack, requestPersistence, testsOf } from '@sioditor/storage';
import type { TestCase } from '@sioditor/storage';
import { Editor } from './Editor.js';
import { ProblemList } from './ProblemList.js';
import { TestPanel } from './TestPanel.js';
import { ProblemSettings } from './ProblemSettings.js';
import { PackBar } from './PackBar.js';
import { usePack } from './usePack.js';
import { StoragePanel } from './StoragePanel.js';
import { useStorage } from './useStorage.js';
import { useRun } from './useRun.js';
import { STARTERS, useWorkspace } from './useWorkspace.js';

const packs = new PackManager();

export function App() {
  const workspace = useWorkspace();
  const current = workspace.current;
  const language: Language = current?.language ?? 'python';
  const runner = useRun();
  const storage = useStorage(packs);
  const [storageOpen, setStorageOpen] = useState(false);

  const pythonPack = usePack(packs, getPack('python'));
  const numpyPack = usePack(packs, getPack('numpy'));
  const cppPack = usePack(packs, getPack('cpp'));
  const pchPack = usePack(packs, getPack('cpp-pch'));
  const activePack = language === 'cpp' ? cppPack : pythonPack;

  useEffect(() => {
    void requestPersistence();
  }, []);

  // The storage layer downloads in the background, including automatically on load. The
  // run buttons hold their own cached answer to "is this pack ready", so they have to be
  // told when that changes - otherwise a pack finishes and Run stays disabled until the
  // page is reloaded.
  const readySignature = storage.packs.map((p) => `${p.pack.id}:${p.ready}`).join(',');
  useEffect(() => {
    pythonPack.recheck();
    cppPack.recheck();
    numpyPack.recheck();
    pchPack.recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readySignature]);

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
    void runner.run(current, cases, pchPack.ready);
  }, [activePack.ready, cases, current, pchPack.ready, runner]);

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
          <button onClick={() => setStorageOpen(true)} title="Pamiec i pakiety">
            Pakiety
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
          {current && <ProblemSettings problem={current} onChange={workspace.update} />}
          <TestPanel
            cases={cases}
            results={runner.results}
            onChange={(next: readonly TestCase[]) => workspace.update({ tests: next })}
            awaitingInput={runner.awaitingInput}
            onSendInput={runner.sendInput}
            onEndInput={runner.endInput}
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

      {storageOpen && (
        <StoragePanel
          storage={storage}
          onClose={() => {
            setStorageOpen(false);
            // Packs may have been added or removed, so the run buttons need re-checking.
            pythonPack.recheck();
            cppPack.recheck();
            numpyPack.recheck();
            pchPack.recheck();
          }}
        />
      )}
    </div>
  );
}
