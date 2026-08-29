import { describe, expect, it } from 'vitest';
import { compareOutput, parsePastedTests } from '../src/tests.js';

describe('output comparison', () => {
  it('matches identical output', () => {
    expect(compareOutput('42\n', '42\n').verdict).toBe('match');
  });

  it('says nothing when there is no expectation', () => {
    expect(compareOutput('anything', '').verdict).toBe('no-expectation');
    expect(compareOutput('anything', '   \n ').verdict).toBe('no-expectation');
  });

  it('accepts a missing final newline, but records that it was not exact', () => {
    // The commonest shape by far: print() adds a newline, pasted expected output has
    // none. Judges accept it, so this must not read as a wrong answer.
    const result = compareOutput('42', '42\n');
    expect(result.verdict).toBe('match');
    expect(result.exact).toBe(false);
  });

  it('accepts trailing spaces the same way', () => {
    expect(compareOutput('1 2 3   \n', '1 2 3\n')).toMatchObject({
      verdict: 'match',
      exact: false,
    });
  });

  it('accepts extra trailing blank lines', () => {
    expect(compareOutput('7\n\n\n', '7\n').verdict).toBe('match');
  });

  it('marks a byte-identical result as exact', () => {
    expect(compareOutput('42\n', '42\n')).toMatchObject({ verdict: 'match', exact: true });
  });

  it('reports a real difference and where it starts', () => {
    const result = compareOutput('1\n9\n3\n', '1\n2\n3\n');
    expect(result.verdict).toBe('differs');
    expect(result.firstDifferingLine).toBe(2);
  });

  it('reports missing lines as a difference, not whitespace', () => {
    const result = compareOutput('1\n', '1\n2\n');
    expect(result.verdict).toBe('differs');
    expect(result.firstDifferingLine).toBe(2);
  });

  it('keeps interior blank lines significant', () => {
    expect(compareOutput('a\n\nb\n', 'a\nb\n').verdict).toBe('differs');
  });
});

describe('parsing pasted tests', () => {
  it('splits a single input/output pair on a blank line', () => {
    expect(parsePastedTests('3\n1 2 3\n\n6')).toEqual([{ input: '3\n1 2 3', expected: '6' }]);
  });

  it('treats input with no blank line as input only', () => {
    expect(parsePastedTests('1 2 3 4')).toEqual([{ input: '1 2 3 4', expected: '' }]);
  });

  it('splits several cases on a marker line', () => {
    const pasted = ['1', '', '1', '---', '2', '', '4'].join('\n');
    expect(parsePastedTests(pasted)).toEqual([
      { input: '1', expected: '1' },
      { input: '2', expected: '4' },
    ]);
  });

  it('accepts decorated separators, as statements tend to use', () => {
    const pasted = '5\n\n25\n=== test 2 ===\n6\n\n36';
    expect(parsePastedTests(pasted)).toEqual([
      { input: '5', expected: '25' },
      { input: '6', expected: '36' },
    ]);
  });

  it('normalises CRLF, since statements are often pasted from Windows', () => {
    expect(parsePastedTests('1\r\n\r\n2')).toEqual([{ input: '1', expected: '2' }]);
  });

  it('falls back to one input-only case rather than refusing', () => {
    const messy = 'a\n\nb\n\nc';
    const parsed = parsePastedTests(messy);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.input).toContain('a');
  });
});
