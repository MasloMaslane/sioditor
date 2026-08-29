export type { CompileFlagOptions } from './flags.js';
export {
  CPP_STANDARD,
  TARGET_TRIPLE,
  SYSROOT,
  USER_STACK_BYTES,
  compileArgs,
  usesAggregateHeader,
  PCH_PATH,
  linkArgs,
} from './flags.js';
export type { Diagnostic } from './diagnostics.js';
export { parseDiagnostics, hasErrors, explainBuildErrors } from './diagnostics.js';
export type { PortabilityNote, PortabilitySeverity } from './portability.js';
export { checkPortability, RECURSION_LIMIT_NOTE } from './portability.js';
export type { Sysroot } from './sysroot.js';
export { parseSysroot } from './sysroot.js';
export type { BuildOptions, BuildResult } from './client.js';
export { CppToolchain } from './client.js';
