export type { RunLimits, RunResult, RunOutcomeKind } from './types.js';
export { DEFAULT_LIMITS } from './types.js';
export type { ExecuteOptions } from './client.js';
export { execute } from './client.js';
export { classifyTrap } from './traps.js';
export type { StdinChannel } from './stdin-channel.js';
export {
  createStdinChannel,
  attachStdinChannel,
  provideStdin,
  closeStdin,
  readStdinBlocking,
  STDIN_IDLE,
  STDIN_WAITING,
  STDIN_READY,
  STDIN_EOF,
} from './stdin-channel.js';
