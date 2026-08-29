import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '@sioditor/editor';
import { PythonRuntime, type RunOutcome } from '@sioditor/runtime-python';
import { CppToolchain, explainBuildErrors, RECURSION_LIMIT_NOTE } from '@sioditor/toolchain-cpp';
import { execute, type RunResult } from '@sioditor/runner';
import { PACKS, PackManager, getPack, requestPersistence } from '@sioditor/storage';
import { Editor } from './Editor.js';
import { Console, type ConsoleLine } from './Console.js';
import { PackBar } from './PackBar.js';
import { usePack } from './usePack.js';

const SAMPLE_PYTHON = `import sys

data = sys.stdin.read().split()
if data:
    print(sum(int(x) for x in data))
else:
    print("podaj liczby na wejsciu")
`;

const SAMPLE_CPP = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    long long x, total = 0;
    while (cin >> x) total += x;
    cout << total << '\\n';
}
`;

const packs = new PackManager();

export function App() {
  const [language, setLanguage] = useState<Language>('python');
  const [source, setSource] = useState(SAMPLE_PYTHON);
  const [stdin, setStdin] = useState('1 2 3 4');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>('');

  const pythonPack = usePack(packs, getPack('python'));
  const cppPack = usePack(packs, getPack('cpp'));
  // Optional extras. Declared in PACKS but previously never rendered, which meant they
  // could not be fetched and so could not work offline - the runtime silently fell back
  // to pulling the wheel over the network.
  const numpyPack = usePack(packs, getPack('numpy'));
  const runtime = useRef<PythonRuntime>(null);
  const toolchain = useRef<CppToolchain>(null);
  const abort = useRef<AbortController>(null);

  useEffect(() => {
    void requestPersistence();
  }, []);

  const switchLanguage = useCallback((next: Language) => {
    setLanguage(next);
    setSource(next === 'cpp' ? SAMPLE_CPP : SAMPLE_PYTHON);
    setLines([]);
    setStatus('');
  }, []);

  const describe = (outcome: RunOutcome): string => {
    switch (outcome.kind) {
      case 'finished':
        return `zakonczono w ${outcome.durationMs} ms`;
      case 'error':
        return `blad wykonania po ${outcome.durationMs} ms`;
      case 'timeout':
        return `przekroczono limit czasu (${outcome.durationMs} ms)`;
      case 'stopped':
        return `zatrzymano po ${outcome.durationMs} ms`;
    }
  };

  const describeBuild = (result: RunResult): string => {
    switch (result.outcome) {
      case 'finished':
        return `zakonczono w ${result.durationMs} ms, pamiec ${(result.peakMemoryBytes / 1048576).toFixed(1)} MB`;
      case 'timed-out':
        return `przekroczono limit czasu (${result.durationMs} ms)`;
      case 'out-of-memory':
        return 'przekroczono limit pamieci';
      case 'stack-overflow':
        return 'przepelnienie stosu';
      case 'crashed':
        return result.exitCode === undefined
          ? `program przerwany: ${result.detail ?? 'nieznany blad'}`
          : `program zakonczyl sie kodem ${result.exitCode}`;
      case 'stopped':
        return `zatrzymano po ${result.durationMs} ms`;
      case 'internal-error':
        return `blad wewnetrzny: ${result.detail ?? 'nieznany'}`;
    }
  };

  const runCpp = useCallback(async () => {
    if (!cppPack.ready) {
      setStatus('najpierw pobierz pakiet C++');
      return;
    }

    setRunning(true);
    setLines([]);
    setStatus('kompilowanie...');

    toolchain.current ??= new CppToolchain(getPack('cpp').baseUrl);
    const controller = new AbortController();
    abort.current = controller;

    try {
      const build = await toolchain.current.build({
        source,
        onPhase: (phase) => setStatus(phase === 'compiling' ? 'kompilowanie...' : 'linkowanie...'),
      });

      // Portability notes come back whether or not the build succeeded; they are about
      // divergence from the judge, not about whether the code compiles here.
      for (const note of build.notes) {
        setLines((prev) => [
          ...prev,
          { stream: 'stderr', text: `${note.line}: ${note.message}\n` },
        ]);
      }

      if (!build.ok || !build.moduleBytes) {
        const explanation = explainBuildErrors(build.rawOutput);
        setLines((prev) => [
          ...prev,
          ...(explanation ? [{ stream: 'stderr' as const, text: `${explanation}\n\n` }] : []),
          { stream: 'stderr' as const, text: build.rawOutput },
        ]);
        setStatus(`blad kompilacji (${build.compileMs} ms)`);
        return;
      }

      setStatus('uruchamianie...');
      const result = await execute({
        moduleBytes: build.moduleBytes,
        stdin,
        signal: controller.signal,
      });
      if (result.stdout) setLines((prev) => [...prev, { stream: 'stdout', text: result.stdout }]);
      if (result.stderr) setLines((prev) => [...prev, { stream: 'stderr', text: result.stderr }]);
      if (result.outcome === 'stack-overflow') {
        // The browser's call stack is far shallower than a judge's, so a correct deep
        // recursion still fails here. Saying so is the difference between a useful tool
        // and one that makes a contestant doubt a working solution.
        setLines((prev) => [...prev, { stream: 'stderr', text: `\n${RECURSION_LIMIT_NOTE}\n` }]);
      }
      setStatus(`kompilacja ${build.compileMs + build.linkMs} ms, ${describeBuild(result)}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLines((prev) => [...prev, { stream: 'stderr', text: `[sioditor] ${message}` }]);
      setStatus(message);
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }, [cppPack.ready, source, stdin]);

  const run = useCallback(async () => {
    if (language === 'cpp') {
      await runCpp();
      return;
    }
    if (!pythonPack.ready) {
      setStatus('najpierw pobierz pakiet Pythona');
      return;
    }

    setRunning(true);
    setLines([]);
    setStatus('uruchamianie...');

    runtime.current ??= new PythonRuntime(getPack('python').baseUrl);
    const controller = new AbortController();
    abort.current = controller;

    try {
      const outcome = await runtime.current.run({
        source,
        stdin,
        onOutput: ({ stream, text }) => setLines((prev) => [...prev, { stream, text }]),
        signal: controller.signal,
      });
      if (outcome.kind === 'error') {
        setLines((prev) => [...prev, { stream: 'stderr', text: outcome.message }]);
      }
      setStatus(describe(outcome));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLines((prev) => [...prev, { stream: 'stderr', text: `[sioditor] ${message}` }]);
      setStatus(message);
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }, [language, runCpp, pythonPack.ready, source, stdin]);

  const stop = useCallback(() => abort.current?.abort(), []);

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
            onClick={() => void run()}
            disabled={running || !(language === 'cpp' ? cppPack : pythonPack).checked}
          >
            Uruchom
          </button>
          <button onClick={stop} disabled={!running}>
            Zatrzymaj
          </button>
        </div>
      </header>

      <PackBar pack={language === 'cpp' ? cppPack : pythonPack} />
      {language === 'python' && <PackBar pack={numpyPack} />}

      <main className="workspace">
        <Editor doc={source} language={language} onChange={setSource} onRun={() => void run()} />
        <aside className="side">
          <label className="panel">
            <span className="panel-title">Wejscie</span>
            <textarea
              value={stdin}
              onChange={(event) => setStdin(event.target.value)}
              spellCheck={false}
            />
          </label>
          <Console lines={lines} status={status} />
        </aside>
      </main>
    </div>
  );
}
