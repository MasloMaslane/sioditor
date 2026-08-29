/** A clang diagnostic mapped onto a position the editor can mark. */
export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: 'error' | 'warning' | 'note';
  readonly message: string;
}

// e.g. "/work/main.cpp:12:5: error: use of undeclared identifier 'n'"
const DIAGNOSTIC_PATTERN =
  /^(?<file>[^\s:][^:]*):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning|note|fatal error):\s*(?<message>.*)$/;

export function parseDiagnostics(stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const raw of stderr.split('\n')) {
    const match = DIAGNOSTIC_PATTERN.exec(raw.trim());
    if (!match?.groups) continue;

    const { file, line, column, severity, message } = match.groups as Record<string, string>;
    diagnostics.push({
      file: file!,
      line: Number(line),
      column: Number(column),
      // A fatal error is still an error as far as the gutter is concerned.
      severity: severity === 'fatal error' ? 'error' : (severity as Diagnostic['severity']),
      message: message!,
    });
  }

  return diagnostics;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
