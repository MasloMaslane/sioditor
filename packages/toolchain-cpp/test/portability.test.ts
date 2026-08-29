import { describe, expect, it } from 'vitest';
import { checkPortability } from '../src/portability.js';
import { parseDiagnostics, hasErrors } from '../src/diagnostics.js';

const messages = (source: string) => checkPortability(source).map((note) => note.message);
const longWarnings = (source: string) =>
  checkPortability(source).filter((note) => note.message.includes('ILP32'));

describe('ILP32 long lint', () => {
  it('flags a bare long declaration', () => {
    const notes = longWarnings('int main() { long total = 0; }');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.line).toBe(1);
  });

  it('flags unsigned long', () => {
    expect(longWarnings('unsigned long mask;')).toHaveLength(1);
  });

  it('does not flag long long, which is 64-bit on both sides', () => {
    expect(longWarnings('long long total = 0;')).toHaveLength(0);
    expect(longWarnings('unsigned long long h = 0;')).toHaveLength(0);
  });

  it('does not flag int64_t', () => {
    expect(longWarnings('int64_t total = 0;')).toHaveLength(0);
  });

  it('does not flag long double as an integer-width problem', () => {
    expect(longWarnings('long double eps = 1e-9;')).toHaveLength(0);
  });

  it('does warn about long double precision, which also differs', () => {
    const notes = checkPortability('long double eps = 1e-9;');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toMatch(/binary128/);
  });

  it('does not flag long int, which is the same 32-bit type', () => {
    // `long int` is still ILP32 here, so it should warn - but exactly once.
    expect(longWarnings('long int total = 0;')).toHaveLength(1);
  });

  it('reports the line the problem is on', () => {
    const notes = longWarnings('#include <bits/stdc++.h>\n\nlong answer;\n');
    expect(notes[0]!.line).toBe(3);
  });

  it('ignores occurrences inside string literals', () => {
    expect(longWarnings('puts("this is a long message");')).toHaveLength(0);
  });

  it('ignores occurrences inside comments', () => {
    expect(longWarnings('// use long here\nint x;')).toHaveLength(0);
    expect(longWarnings('/* a long\n   comment */\nint x;')).toHaveLength(0);
  });

  it('still flags real code on a line that also has a comment', () => {
    expect(longWarnings('long total; // running total')).toHaveLength(1);
  });
});

describe('other g++ divergences', () => {
  it('notes that GCC optimize pragmas do nothing', () => {
    expect(messages('#pragma GCC optimize("O3")').join()).toMatch(/ignoruje/);
  });

  it('rejects x86 intrinsics as an error, not a warning', () => {
    const notes = checkPortability('#include <immintrin.h>');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('error');
  });

  it('is quiet on ordinary OI code', () => {
    const source = [
      '#include <bits/stdc++.h>',
      'using namespace std;',
      'int main() {',
      '    long long n;',
      '    cin >> n;',
      '    vector<int> a(n);',
      '    cout << accumulate(a.begin(), a.end(), 0LL) << "\\n";',
      '}',
    ].join('\n');
    expect(checkPortability(source)).toEqual([]);
  });
});

describe('clang diagnostics parsing', () => {
  const stderr = [
    "/work/main.cpp:4:9: error: use of undeclared identifier 'n'",
    '    cin >> n;',
    '           ^',
    '/work/main.cpp:7:5: warning: unused variable [-Wunused-variable]',
    '/work/main.cpp:1:10: fatal error: no such file',
  ].join('\n');

  it('extracts position and severity', () => {
    const diagnostics = parseDiagnostics(stderr);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[0]).toMatchObject({ line: 4, column: 9, severity: 'error' });
    expect(diagnostics[1]).toMatchObject({ line: 7, severity: 'warning' });
  });

  it('treats a fatal error as an error', () => {
    expect(parseDiagnostics(stderr)[2]!.severity).toBe('error');
  });

  it('ignores source echo and caret lines', () => {
    expect(parseDiagnostics(stderr).map((d) => d.message)).not.toContain('^');
  });

  it('reports whether anything blocks a build', () => {
    expect(hasErrors(parseDiagnostics(stderr))).toBe(true);
    expect(hasErrors(parseDiagnostics('/w/a.cpp:1:1: warning: meh'))).toBe(false);
  });
});
