import { describe, expect, it } from 'vitest';
import { requiredPacks } from '../src/imports.js';

describe('import detection', () => {
  it('spots a plain import', () => {
    expect(requiredPacks('import numpy')).toEqual(['numpy']);
  });

  it('spots an aliased import, which is how OI code writes it', () => {
    expect(requiredPacks('import numpy as np')).toEqual(['numpy']);
  });

  it('spots a from-import', () => {
    expect(requiredPacks('from numpy import array')).toEqual(['numpy']);
  });

  it('does not fire on an unrelated module', () => {
    expect(requiredPacks('import sys\nimport itertools')).toEqual([]);
  });

  it('does not fire on a bare np, which is not an importable module', () => {
    expect(requiredPacks('import np')).toEqual([]);
  });

  it('reports each pack once', () => {
    expect(requiredPacks('import numpy\nfrom numpy import zeros')).toEqual(['numpy']);
  });
});
