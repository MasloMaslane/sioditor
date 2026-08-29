import type { RunOutcomeKind } from './types.js';

/**
 * Reads a wasm trap message and decides what actually happened.
 *
 * Engines do not distinguish these structurally - a stack overflow, an out-of-memory and
 * a bad access all arrive as a thrown Error - so the message text is the only signal
 * available. Order matters: a stack overflow in V8 mentions both "stack" and "RangeError",
 * while an allocation failure mentions "memory", and the stack case is checked first
 * because it is the one that needs a specific explanation.
 */
export function classifyTrap(message: string): RunOutcomeKind {
  if (/call stack|stack size|stack exhaust|RangeError/i.test(message)) return 'stack-overflow';
  if (/memory|allocation|grow|out of bounds/i.test(message)) return 'out-of-memory';
  return 'crashed';
}
