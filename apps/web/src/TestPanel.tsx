import { useState } from 'react';
import { parsePastedTests, type Comparison, type TestCase } from '@sioditor/storage';
import type { CaseResult } from './useRun.js';

const VERDICT_LABEL: Record<Comparison['verdict'], string> = {
  match: 'zgodne',
  'no-expectation': 'brak wzorca',
  differs: 'rozne',
};

const FAILURE_LABEL: Record<string, string> = {
  'timed-out': 'limit czasu',
  'out-of-memory': 'limit pamieci',
  'stack-overflow': 'przepelnienie stosu',
  crashed: 'blad wykonania',
  stopped: 'zatrzymano',
  'internal-error': 'blad wewnetrzny',
  error: 'blad wykonania',
  timeout: 'limit czasu',
};

interface TestPanelProps {
  cases: readonly TestCase[];
  results: ReadonlyMap<string, CaseResult>;
  onChange: (cases: readonly TestCase[]) => void;
  /** The case whose program is blocked waiting for a line, if any. */
  awaitingInput?: string | undefined;
  onSendInput?: (text: string) => void;
  onEndInput?: () => void;
}

const newCase = (input = '', expected = ''): TestCase => ({
  id: crypto.randomUUID(),
  input,
  expected,
});

/**
 * The test cases for the open problem.
 *
 * Built around pasting, because that is how sample tests arrive - straight out of a task
 * statement - and typing them back in by hand is the tedium this is meant to remove.
 */
export function TestPanel({
  cases,
  results,
  onChange,
  awaitingInput,
  onSendInput,
  onEndInput,
}: TestPanelProps) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  const patch = (id: string, fields: Partial<TestCase>) =>
    onChange(cases.map((c) => (c.id === id ? { ...c, ...fields } : c)));

  const acceptPaste = () => {
    const parsed = parsePastedTests(pasted).map((p) => newCase(p.input, p.expected));
    if (parsed.length > 0) onChange([...cases, ...parsed]);
    setPasted('');
    setPasting(false);
  };

  return (
    <section className="tests">
      <div className="tests-head">
        <span className="panel-title">Testy</span>
        <div className="tests-actions">
          <button onClick={() => onChange([...cases, newCase()])}>+ test</button>
          <button onClick={() => setPasting((open) => !open)}>Wklej</button>
        </div>
      </div>

      {pasting && (
        <div className="paste-box">
          <textarea
            autoFocus
            placeholder={
              'Wklej testy ze tresci zadania.\n\nWejscie i wyjscie rozdziel pusta linia,\nkolejne testy linia ---'
            }
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            spellCheck={false}
          />
          <div className="tests-actions">
            <button className="primary" onClick={acceptPaste}>
              Dodaj
            </button>
            <button onClick={() => setPasting(false)}>Anuluj</button>
          </div>
        </div>
      )}

      <ol className="case-list">
        {cases.map((testCase, index) => {
          const result = results.get(testCase.id);
          const verdict = result?.failure
            ? (FAILURE_LABEL[result.failure] ?? result.failure)
            : result
              ? VERDICT_LABEL[result.comparison.verdict]
              : undefined;
          const tone = result?.failure
            ? 'bad'
            : result?.comparison.verdict === 'match'
              ? 'good'
              : result?.comparison.verdict === 'differs'
                ? 'bad'
                : 'neutral';

          return (
            <li key={testCase.id} className="case">
              <div className="case-head">
                <span className="case-index">#{index + 1}</span>
                {verdict && <span className={`chip ${tone}`}>{verdict}</span>}
                {result && (
                  <span className="case-metrics">
                    {result.durationMs} ms
                    {result.peakMemoryBytes !== undefined &&
                      ` · ${(result.peakMemoryBytes / 1048576).toFixed(1)} MB`}
                  </span>
                )}
                <button
                  className="case-remove"
                  title="Usun test"
                  onClick={() => onChange(cases.filter((c) => c.id !== testCase.id))}
                >
                  ×
                </button>
              </div>

              <div className="case-grid">
                <label>
                  <span>wejscie</span>
                  <textarea
                    value={testCase.input}
                    onChange={(event) => patch(testCase.id, { input: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label>
                  <span>oczekiwane</span>
                  <textarea
                    value={testCase.expected}
                    onChange={(event) => patch(testCase.id, { expected: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                {result && (
                  <label>
                    <span>
                      otrzymane
                      {result.comparison.firstDifferingLine !== undefined &&
                        ` · pierwsza roznica w linii ${result.comparison.firstDifferingLine}`}
                    </span>
                    <pre className={tone === 'bad' ? 'bad' : undefined}>
                      {result.stdout || '(brak wyjscia)'}
                      {result.stderr && `\n${result.stderr}`}
                    </pre>
                  </label>
                )}
              </div>

              {awaitingInput === testCase.id && (
                <form
                  className="await-input"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const field = event.currentTarget.elements.namedItem('line');
                    if (field instanceof HTMLInputElement) {
                      onSendInput?.(field.value);
                      field.value = '';
                    }
                  }}
                >
                  <span>program czeka na wejscie</span>
                  <input name="line" autoFocus autoComplete="off" placeholder="wpisz linie" />
                  <button type="submit" className="primary">
                    Wyslij
                  </button>
                  <button type="button" onClick={() => onEndInput?.()} title="Koniec wejscia">
                    EOF
                  </button>
                </form>
              )}

              {result?.comparison.verdict === 'match' && !result.comparison.exact && (
                <p className="case-hint">
                  Zgodne po pominieciu bialych znakow na koncach linii i konca pliku - tak samo jak
                  robi to sedzia.
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {cases.length === 0 && (
        <p className="tests-empty">Brak testow. Dodaj lub wklej je ze tresci zadania.</p>
      )}
    </section>
  );
}
