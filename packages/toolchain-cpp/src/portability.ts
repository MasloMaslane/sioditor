/**
 * Warnings about ways this toolchain differs from the g++ on the judge.
 *
 * These are not compiler errors. They exist because the divergences below produce code
 * that behaves correctly here and wrongly on the judge, or the reverse - the worst
 * possible failure mode for a practice tool, since it teaches the wrong lesson silently.
 */
export type PortabilitySeverity = 'error' | 'warning';

export interface PortabilityNote {
  readonly line: number;
  readonly column: number;
  readonly severity: PortabilitySeverity;
  readonly message: string;
}

/** Strips string and character literals and comments so scans do not match inside them. */
function blankOutLiteralsAndComments(source: string): string {
  let out = '';
  let index = 0;
  const n = source.length;

  while (index < n) {
    const two = source.slice(index, index + 2);

    if (two === '//') {
      while (index < n && source[index] !== '\n') {
        out += ' ';
        index++;
      }
      continue;
    }

    if (two === '/*') {
      while (index < n && source.slice(index, index + 2) !== '*/') {
        out += source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      out += '  ';
      index += 2;
      continue;
    }

    const char = source[index];
    if (char === '"' || char === "'") {
      const quote = char;
      out += ' ';
      index++;
      while (index < n && source[index] !== quote) {
        if (source[index] === '\\') {
          out += ' ';
          index++;
        }
        out += source[index] === '\n' ? '\n' : ' ';
        index++;
      }
      out += ' ';
      index++;
      continue;
    }

    out += char;
    index++;
  }

  return out;
}

/**
 * Matches a whole `long`-family type phrase in one go.
 *
 * Matching a bare `long` and excluding the two-word case with a lookahead does not work:
 * in `long long n` the scan simply restarts on the second word and matches there. Taking
 * the entire phrase and then counting its words is the only reliable reading.
 */
const LONG_PHRASE_PATTERN = /\b(?:(?:un)?signed\s+)?long(?:\s+long)?(?:\s+(?:int|double))?\b/g;

/** Ignored by clang with a warning; harmless, but the noise confuses students. */
const GCC_PRAGMA_PATTERN = /^\s*#\s*pragma\s+GCC\s+(?:optimize|target)\b/gm;

/** x86 intrinsics simply do not exist on wasm32. */
const X86_INTRINSICS_PATTERN = /^\s*#\s*include\s*<(?:immintrin|emmintrin|xmmintrin|x86intrin)\.h>/gm;

function positionOf(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return { line, column: offset - lastNewline };
}

export function checkPortability(source: string): PortabilityNote[] {
  const scannable = blankOutLiteralsAndComments(source);
  const notes: PortabilityNote[] = [];

  for (const match of scannable.matchAll(LONG_PHRASE_PATTERN)) {
    const phrase = match[0];

    // `long long` is 64-bit on both sides - the whole point of the advice below.
    if (/long\s+long/.test(phrase)) continue;

    if (/long\s+double/.test(phrase)) {
      notes.push({
        ...positionOf(source, match.index),
        severity: 'warning',
        message:
          '`long double` to tu binary128 (softwarowe), a na sedzi x87 80-bit: inna precyzja ' +
          'i duzo wolniej. W zadaniach geometrycznych wyniki moga sie roznic.',
      });
      continue;
    }

    notes.push({
      ...positionOf(source, match.index),
      severity: 'warning',
      message:
        '`long` ma tu 32 bity (wasm32 jest ILP32), a na sedzi 64. Uzyj `long long` albo `int64_t`.',
    });
  }

  for (const match of scannable.matchAll(GCC_PRAGMA_PATTERN)) {
    notes.push({
      ...positionOf(source, match.index),
      severity: 'warning',
      message: 'clang ignoruje `#pragma GCC optimize/target` - nie ma efektu.',
    });
  }

  for (const match of scannable.matchAll(X86_INTRINSICS_PATTERN)) {
    notes.push({
      ...positionOf(source, match.index),
      severity: 'error',
      message: 'Intrinsics x86 nie istnieja na wasm32.',
    });
  }

  return notes.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * The engine's own call stack, which no page can resize, caps wasm recursion at roughly
 * three to eight thousand frames for a realistic C++ frame - far below the ~10^6 a judge
 * allows. A deep DFS that is correct will still fail here, so the message has to say so
 * rather than let a contestant conclude their solution is broken.
 */
export const RECURSION_LIMIT_NOTE =
  'Przepelnienie stosu. Przegladarka pozwala na okolo 3-8 tysiecy poziomow rekursji, ' +
  'sedzia na duzo wiecej - to ograniczenie tego edytora, niekoniecznie blad rozwiazania.';
