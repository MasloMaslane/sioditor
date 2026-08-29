import { unzipSync, zipSync } from 'fflate';
import type { Problem } from './workspace.js';
import { testsOf } from './workspace.js';

const EXTENSION: Record<Problem['language'], string> = { cpp: 'cpp', python: 'py' };
const MANIFEST = 'sioditor.json';

interface ManifestProblem {
  readonly id: string;
  readonly name: string;
  readonly language: Problem['language'];
  readonly timeLimitMs: number;
  readonly memoryLimitBytes: number;
  readonly updatedAt: number;
  readonly directory: string;
  readonly sourceFile: string;
}

/** Safe as a directory name on every platform, and still recognisable. */
function slug(name: string, fallback: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w .-]+/g, '-')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

/**
 * Packs the workspace into a zip.
 *
 * Laid out so it is useful outside this tool too: one directory per problem holding the
 * source under its natural extension and the tests as the `.in`/`.out` pairs every judge
 * and test runner already understands. A JSON manifest carries what those files cannot -
 * limits, language, ordering - and importing without it still works.
 */
export function exportWorkspace(problems: readonly Problem[]): Uint8Array<ArrayBuffer> {
  const files: Record<string, Uint8Array> = {};
  const encoder = new TextEncoder();
  const manifest: ManifestProblem[] = [];
  const used = new Set<string>();

  problems.forEach((problem, index) => {
    let directory = slug(problem.name, `zadanie-${index + 1}`);
    // Two problems may legitimately share a name; the archive cannot.
    let suffix = 2;
    while (used.has(directory)) directory = `${slug(problem.name, 'zadanie')}-${suffix++}`;
    used.add(directory);

    const sourceFile = `main.${EXTENSION[problem.language]}`;
    files[`${directory}/${sourceFile}`] = encoder.encode(problem.source);

    testsOf(problem).forEach((testCase, caseIndex) => {
      const stem = `${directory}/tests/${String(caseIndex + 1).padStart(2, '0')}`;
      files[`${stem}.in`] = encoder.encode(testCase.input);
      if (testCase.expected.trim() !== '') {
        files[`${stem}.out`] = encoder.encode(testCase.expected);
      }
    });

    manifest.push({
      id: problem.id,
      name: problem.name,
      language: problem.language,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitBytes: problem.memoryLimitBytes,
      updatedAt: problem.updatedAt,
      directory,
      sourceFile,
    });
  });

  files[MANIFEST] = encoder.encode(JSON.stringify({ version: 1, problems: manifest }, null, 2));
  return zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>;
}

const DEFAULTS = { timeLimitMs: 5000, memoryLimitBytes: 256 * 1048576 };

/**
 * Reads a workspace back.
 *
 * The manifest is used when present, but an archive without one - someone's own folder of
 * solutions, or an export from a future version - still imports: the layout alone says
 * enough, and refusing would be worse than guessing at the limits.
 */
export function importWorkspace(archive: Uint8Array<ArrayBuffer>): Problem[] {
  const files = unzipSync(archive);
  const decoder = new TextDecoder();
  const manifest: ManifestProblem[] = (() => {
    const raw = files[MANIFEST];
    if (!raw) return [];
    try {
      return (JSON.parse(decoder.decode(raw)) as { problems?: ManifestProblem[] }).problems ?? [];
    } catch {
      return [];
    }
  })();

  const byDirectory = new Map(manifest.map((entry) => [entry.directory, entry]));
  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const path of Object.keys(files).sort()) {
    const match = /^([^/]+)\/main\.(cpp|py)$/.exec(path);
    if (!match) continue;
    const [, directory, extension] = match;
    if (seen.has(directory!)) continue;
    seen.add(directory!);

    const entry = byDirectory.get(directory!);
    const language = entry?.language ?? (extension === 'cpp' ? 'cpp' : 'python');

    const tests = Object.keys(files)
      .filter((name) => name.startsWith(`${directory}/tests/`) && name.endsWith('.in'))
      .sort()
      .map((inputPath) => ({
        id: crypto.randomUUID(),
        input: decoder.decode(files[inputPath]!),
        expected: (() => {
          const expected = files[inputPath.replace(/\.in$/, '.out')];
          return expected ? decoder.decode(expected) : '';
        })(),
      }));

    problems.push({
      id: crypto.randomUUID(),
      name: entry?.name ?? directory!,
      language,
      source: decoder.decode(files[path]!),
      tests,
      timeLimitMs: entry?.timeLimitMs ?? DEFAULTS.timeLimitMs,
      memoryLimitBytes: entry?.memoryLimitBytes ?? DEFAULTS.memoryLimitBytes,
      updatedAt: Date.now(),
    });
  }

  return problems;
}
