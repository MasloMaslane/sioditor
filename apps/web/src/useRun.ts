import { useCallback, useRef, useState } from 'react';
import { CppToolchain, explainBuildErrors, RECURSION_LIMIT_NOTE } from '@sioditor/toolchain-cpp';
import { PythonRuntime } from '@sioditor/runtime-python';
import {
  closeStdin,
  createStdinChannel,
  execute,
  provideStdin,
  type StdinChannel,
} from '@sioditor/runner';
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
  /** The case currently blocked on input, if any. */
  readonly awaitingInput: string | undefined;
  /** Answers a blocked program. A newline is appended, as pressing enter would. */
  readonly sendInput: (text: string) => void;
  /** Tells a blocked program that nothing more is coming. */
  readonly endInput: () => void;
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

  const [awaitingInput, setAwaitingInput] = useState<string>();
  const channel = useRef<StdinChannel>(null);
  const python = useRef<PythonRuntime>(null);
  const toolchain = useRef<CppToolchain>(null);
  const pchLoaded = useRef<boolean>(false);
  const abort = useRef<AbortController>(null);

  const clear = useCallback(() => {
    setResults(new Map());
    setBuildOutput('');
    setStatus('');
    setAwaitingInput(undefined);
  }, []);

  /**
   * Interactive input needs a SharedArrayBuffer, which exists only on a cross-origin
   * isolated page. The server sets the headers, but a misconfigured proxy would drop
   * them - in which case running still works and only live input is unavailable.
   */
  const isolated = typeof SharedArrayBuffer === 'function' && self.crossOriginIsolated;

  const sendInput = useCallback((text: string) => {
    if (channel.current) provideStdin(channel.current, `${text}\n`);
    setAwaitingInput(undefined);
  }, []);

  const endInput = useCallback(() => {
    if (channel.current) closeStdin(channel.current);
    setAwaitingInput(undefined);
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
        channel.current = isolated && problem.interactive ? createStdinChannel() : null;
        const result = await execute({
          moduleBytes: build.moduleBytes,
          stdin: testCase.input,
          limits: { timeLimitMs: problem.timeLimitMs, memoryLimitBytes: problem.memoryLimitBytes },
          signal,
          ...(channel.current
            ? {
                stdinChannel: channel.current.header.buffer as SharedArrayBuffer,
                onNeedsInput: () => setAwaitingInput(testCase.id),
              }
            : {}),
        });
        setAwaitingInput(undefined);
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
    [isolated, record],
  );

  const runPython = useCallback(
    async (problem: Problem, cases: readonly TestCase[], signal: AbortSignal) => {
      python.current ??= new PythonRuntime(getPack('python').baseUrl);

      for (const testCase of cases) {
        if (signal.aborted) break;
        setStatus(`uruchamianie ${cases.indexOf(testCase) + 1}/${cases.length}...`);

        let stdout = '';
        let stderr = '';
        channel.current = isolated && problem.interactive ? createStdinChannel() : null;
        const outcome = await python.current.run({
          source: problem.source,
          stdin: testCase.input,
          timeLimitMs: problem.timeLimitMs,
          ...(channel.current
            ? {
                stdinChannel: channel.current.header.buffer as SharedArrayBuffer,
                onNeedsInput: () => setAwaitingInput(testCase.id),
              }
            : {}),
          onOutput: ({ stream, text }) => {
            if (stream === 'stdout') stdout += text;
            else stderr += text;
          },
          signal,
        });
        setAwaitingInput(undefined);
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
    [isolated, record],
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

  const stop = useCallback(() => {
    // Release a blocked read first: a program parked in Atomics.wait would otherwise sit
    // there until the time limit, and the page would keep showing a prompt.
    if (channel.current) closeStdin(channel.current);
    setAwaitingInput(undefined);
    abort.current?.abort();
  }, []);

  return {
    running,
    status,
    results,
    buildOutput,
    awaitingInput,
    sendInput,
    endInput,
    run,
    stop,
    clear,
  };
}
