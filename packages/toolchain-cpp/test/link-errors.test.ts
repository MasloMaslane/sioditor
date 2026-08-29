import { describe, expect, it } from 'vitest';
import { explainBuildErrors } from '../src/diagnostics.js';

describe('build error explanations', () => {
  it('explains the compile-time form, which is what a direct throw produces', () => {
    const stderr = "main.cpp:2:14: error: cannot use 'throw' with exceptions disabled";
    expect(explainBuildErrors(stderr)).toMatch(/Wyjatki/);
  });

  it('explains the undefined __cxa_throw that any throw produces', () => {
    const stderr = 'wasm-ld: error: /work/main.o: undefined symbol: __cxa_throw';
    expect(explainBuildErrors(stderr)).toMatch(/Wyjatki/);
  });

  it('also catches the allocate-exception spelling', () => {
    expect(explainBuildErrors('undefined symbol: __cxa_allocate_exception')).toMatch(/Wyjatki/);
  });

  it('names a missing main', () => {
    expect(explainBuildErrors('wasm-ld: error: undefined symbol: main')).toMatch(/main/);
  });

  it('says nothing about link errors it does not recognise', () => {
    expect(explainBuildErrors('undefined symbol: some_user_function')).toBeUndefined();
  });

  it('says nothing for a clean build', () => {
    expect(explainBuildErrors('')).toBeUndefined();
  });
});
