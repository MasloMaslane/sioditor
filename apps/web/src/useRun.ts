import { useCallback, useRef, useState } from 'react';
import { CppToolchain, explainBuildErrors, RECURSION_LIMIT_NOTE } from '@sioditor/toolchain-cpp';
import { PythonRuntime } from '@sioditor/runtime-python';
import { execute } from '@sioditor/runner';
import {
  compareOutput,
  getPack,
  type Comparison,
  type Language,
  type Problem,
  type TestCase,
} from '@sioditor/storage';

export interface CaseResult {
  readonly caseId: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly peakMemoryBytes?: number;
  readonly comparison: Comparison;
  /** Set when the program did not finish normally. */
  readonly failure?: string;
}

export interface RunState {
  readonly running: boolean;
  readonly status: string;
  readonly results: ReadonlyMap<string, CaseResult>;
  readonly buildOutput: string;
  readonly run: (problem: Problem, cases: readonly TestCase[], usePch?: boolean) => Promise<void>;
  readonly stop: () => void;
  readonly clear: () => void;
}

/**
 * Runs a problem against every test case.
 *
 * C++ is compiled once and the resulting module executed per case; Python is interpreted
 * per case. Cases run in sequence rather than in parallel - the timings are meant to give
 * a feel for whether a solution is in the right complexity class, and parallel runs on a
 * shared machine would make them noise.
 */
export function useRun(): RunState {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<ReadonlyMap<string, CaseResult>>(new Map());
  const [buildOutput, setBuildOutput] = useState('');

  const python = useRef<PythonRuntime>(null);
  const toolchain = useRef<CppToolchain>(null);
  const pchLoaded = useRef<boolean>(false);
  const abort = useRef<AbortController>(null);

  const clear = useCallback(() => {
    setResults(new Map());
    setBuildOutput('');
    setStatus('');
  }, []);

  const record = useCallback((result: CaseResult) => {
    setResults((prev) => new Map(prev).set(result.caseId, result));
  }, []);

  const runCpp = useCallback(
    async (problem: Problem, cases: readonly TestCase[], signal: AbortSignal, usePch: boolean) => {
      // The worker loads the PCH once at startup, so installing the pack later has to
      // rebuild it - otherwise the speedup only appears after a page reload.
      if (toolchain.current && pchLoaded.current !== usePch) {
        toolchain.current.dispose();
        toolchain.current = null;
      }
      if (!toolchain.current) {
        toolchain.current = new CppToolchain(getPack('cpp').baseUrl, usePch);
        pchLoaded.current = usePch;
      }
      setStatus('kompilowanie...');

      const build = await toolchain.current.build({
        source: problem.source,
        memoryLimitBytes: problem.memoryLimitBytes,
        onPhase: (phase) => setStatus(phase === 'compiling' ? 'kompilowanie...' : 'linkowanie...'),
      });

      const notes = build.notes.map((note) => `${note.line}: ${note.message}`).join('\n');

      if (!build.ok || !build.moduleBytes) {
        const explanation = explainBuildErrors(build.rawOutput);
        setBuildOutput([notes, explanation, build.rawOutput].filter(Boolean).join('\n\n'));
        setStatus(`blad kompilacji (${build.compileMs} ms)`);
        return;
      }
      setBuildOutput(notes);

      for (const testCase of cases) {
        if (signal.aborted) break;
        setStatus(`uruchamianie ${cases.indexOf(testCase) + 1}/${cases.length}...`);
        const result = await execute({
          moduleBytes: build.moduleBytes,
          stdin: testCase.input,
          limits: { timeLimitMs: problem.timeLimitMs, memoryLimitBytes: problem.memoryLimitBytes },
          signal,
        });
        record({
          caseId: testCase.id,
          stdout: result.stdout,
          stderr:
            result.outcome === 'stack-overflow'
              ? `${result.stderr}\n${RECURSION_LIMIT_NOTE}`
              : result.stderr,
          durationMs: result.durationMs,
          peakMemoryBytes: result.peakMemoryBytes,
          comparison: compareOutput(result.stdout, testCase.expected),
          ...(result.outcome === 'finished' ? {} : { failure: result.outcome }),
        });
      }
      setStatus(`kompilacja ${build.compileMs + build.linkMs} ms`);
    },
    [record],
  );

  const runPython = useCallback(
    async (problem: Problem, cases: readonly TestCase[], signal: AbortSignal) => {
      python.current ??= new PythonRuntime(getPack('python').baseUrl);

      for (const testCase of cases) {
        if (signal.aborted) break;
        setStatus(`uruchamianie ${cases.indexOf(testCase) + 1}/${cases.length}...`);

        let stdout = '';
        let stderr = '';
        const outcome = await python.current.run({
          source: problem.source,
          stdin: testCase.input,
          timeLimitMs: problem.timeLimitMs,
          onOutput: ({ stream, text }) => {
            if (stream === 'stdout') stdout += text;
            else stderr += text;
          },
          signal,
        });
        if (outcome.kind === 'error') stderr += outcome.message;

        record({
          caseId: testCase.id,
          stdout,
          stderr,
          durationMs: outcome.durationMs,
          comparison: compareOutput(stdout, testCase.expected),
          ...(outcome.kind === 'finished' ? {} : { failure: outcome.kind }),
        });
      }
      setStatus('');
    },
    [record],
  );

  const run = useCallback(
    async (problem: Problem, cases: readonly TestCase[], usePch = false) => {
      if (cases.length === 0) {
        setStatus('dodaj przynajmniej jeden test');
        return;
      }

      setRunning(true);
      clear();
      const controller = new AbortController();
      abort.current = controller;

      try {
        const language: Language = problem.language;
        if (language === 'cpp') await runCpp(problem, cases, controller.signal, usePch);
        else await runPython(problem, cases, controller.signal);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setBuildOutput(`[sioditor] ${message}`);
        setStatus(message);
      } finally {
        setRunning(false);
        abort.current = null;
      }
    },
    [clear, runCpp, runPython],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  return { running, status, results, buildOutput, run, stop, clear };
}
