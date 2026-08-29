import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '@sioditor/editor';
import { PythonRuntime, type RunOutcome } from '@sioditor/runtime-python';
import { PackManager, getPack, requestPersistence } from '@sioditor/storage';
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
  const runtime = useRef<PythonRuntime>(null);
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

  const run = useCallback(async () => {
    if (language === 'cpp') {
      setStatus('kompilator C++ jeszcze nie jest podlaczony - patrz docs/toolchain.md');
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
      setStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }, [language, pythonPack.ready, source, stdin]);

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
            disabled={running || !pythonPack.checked}
          >
            Uruchom
          </button>
          <button onClick={stop} disabled={!running}>
            Zatrzymaj
          </button>
        </div>
      </header>

      <PackBar pack={pythonPack} />

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
