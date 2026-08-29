/** One test case. `expected` empty means "just run it and show me the output". */
export interface TestCase {
  readonly id: string;
  readonly input: string;
  readonly expected: string;
}

export type ComparisonVerdict = 'match' | 'no-expectation' | 'differs';

export interface Comparison {
  readonly verdict: ComparisonVerdict;
  /**
   * True when the output was byte-identical. False on a match means the two differed
   * only in trailing whitespace.
   *
   * This is a flag rather than a verdict of its own. `print` ends with a newline and
   * expected output pasted from a statement does not, so a trailing-newline difference is
   * the *normal* case - making it a distinct amber state would light up almost every
   * passing test and teach people to ignore the colour. Judges ignore trailing
   * whitespace, so this does too, and just mentions it.
   */
  readonly exact: boolean;
  /** Index of the first differing line, for pointing the user at it. */
  readonly firstDifferingLine?: number;
}

/** Trailing whitespace per line, and trailing blank lines, removed. */
function canonical(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .reduce<string[]>((lines, line, index, all) => {
      // Drop trailing blank lines, but keep interior ones.
      if (line === '' && all.slice(index).every((rest) => rest.trim() === '')) return lines;
      lines.push(line);
      return lines;
    }, []);
}

/**
 * Compares program output against what was expected.
 *
 * `whitespace-only` exists as a distinct answer on purpose. A missing final newline or a
 * trailing space is the single most common reason a correct solution looks wrong here,
 * and most judges ignore both - so reporting it as a plain mismatch sends people hunting
 * for a bug that is not there.
 */
export function compareOutput(actual: string, expected: string): Comparison {
  if (expected.trim() === '') return { verdict: 'no-expectation', exact: actual === expected };
  if (actual === expected) return { verdict: 'match', exact: true };

  const a = canonical(actual);
  const b = canonical(expected);

  if (a.length === b.length && a.every((line, i) => line === b[i])) {
    return { verdict: 'match', exact: false };
  }

  const upTo = Math.max(a.length, b.length);
  for (let i = 0; i < upTo; i++) {
    if (a[i] !== b[i]) return { verdict: 'differs', exact: false, firstDifferingLine: i + 1 };
  }
  return { verdict: 'differs', exact: false };
}

/**
 * Splits a pasted block into cases.
 *
 * Contestants paste sample tests straight out of a task statement, so this accepts the
 * shapes that actually appear there: cases separated by a marker line, or a single
 * input/output pair separated by one. Anything it cannot parse becomes one input-only
 * case rather than being rejected - a wrong guess that is easy to fix beats a refusal.
 */
export function parsePastedTests(text: string): Array<{ input: string; expected: string }> {
  const normalised = text.replace(/\r\n/g, '\n');

  // A line of ---, ===, or === 2 === style markers separates cases.
  const caseBlocks = normalised
    .split(/^\s*[-=*_]{3,}.*$/m)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim() !== '');

  if (caseBlocks.length > 1) {
    return caseBlocks.map((block) => splitInputOutput(block));
  }
  return [splitInputOutput(normalised.replace(/^\n+|\n+$/g, ''))];
}

/** A blank line splits input from expected output, when there is exactly one. */
function splitInputOutput(block: string): { input: string; expected: string } {
  const halves = block.split(/\n[ \t]*\n/);
  if (halves.length === 2) {
    return { input: halves[0]!.trim(), expected: halves[1]!.trim() };
  }
  return { input: block.trim(), expected: '' };
}
