export type { CompileFlagOptions } from './flags.js';
export {
  CPP_STANDARD,
  TARGET_TRIPLE,
  SYSROOT,
  USER_STACK_BYTES,
  compileArgs,
  linkArgs,
} from './flags.js';
export type { Diagnostic } from './diagnostics.js';
export { parseDiagnostics, hasErrors } from './diagnostics.js';
export type { PortabilityNote, PortabilitySeverity } from './portability.js';
export { checkPortability, RECURSION_LIMIT_NOTE } from './portability.js';
