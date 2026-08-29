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

/**
 * Turns build failures with a known cause into something a contestant can act on.
 *
 * Exceptions are the case that matters. The sysroot ships the no-exceptions libc++ (see
 * flags.ts for why), so a direct `throw` is rejected at compile time with "cannot use
 * 'throw' with exceptions disabled" - accurate, but it does not say that this is a
 * property of this editor rather than of their code. Library code that throws shows up
 * instead as an undefined `__cxa_throw` at link, which is worse.
 */
export function explainBuildErrors(stderr: string): string | undefined {
  if (/exceptions disabled|__cxa_throw|__cxa_allocate_exception|__cxa_begin_catch/.test(stderr)) {
    return (
      'Wyjatki (throw / try / catch) nie sa na razie obslugiwane w tym edytorze - ' +
      'biblioteka standardowa jest zbudowana bez nich. Dotyczy to tez funkcji, ktore ' +
      'rzucaja same z siebie, np. std::stoi czy vector::at. Uzyj wariantow, ktore nie ' +
      'rzucaja (std::strtoll, operator[]).'
    );
  }
  if (/undefined symbol: main\b/.test(stderr)) {
    return 'Brakuje funkcji main().';
  }
  return undefined;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
