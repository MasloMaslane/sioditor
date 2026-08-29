import { describe, expect, it } from 'vitest';
import { classifyTrap } from '../src/traps.js';

describe('trap classification', () => {
  it('recognises V8 stack exhaustion', () => {
    expect(classifyTrap('RangeError: Maximum call stack size exceeded')).toBe('stack-overflow');
  });

  it('recognises the wasm phrasing of the same thing', () => {
    expect(classifyTrap('RuntimeError: call stack exhausted')).toBe('stack-overflow');
  });

  it('prefers stack overflow over memory when a message mentions both', () => {
    // V8's stack-overflow text can mention memory; the stack reading is the useful one.
    expect(classifyTrap('Maximum call stack size exceeded (memory)')).toBe('stack-overflow');
  });

  it('recognises allocation failure', () => {
    expect(classifyTrap('RuntimeError: memory access out of bounds')).toBe('out-of-memory');
    expect(classifyTrap('failed to grow memory')).toBe('out-of-memory');
  });

  it('falls back to a plain crash', () => {
    expect(classifyTrap('RuntimeError: unreachable')).toBe('crashed');
    expect(classifyTrap('divide by zero')).toBe('crashed');
  });
});
