/**
 * Maps top-level imports in user code to the asset packs that provide them.
 *
 * `import numpy` should simply work once the pack is present - making a contestant write
 * micropip incantations to use a library we already shipped would be a silly tax.
 */
const PACK_BY_MODULE = new Map<string, string>([
  ['numpy', 'numpy'],
  ['np', 'numpy'],
]);

const IMPORT_PATTERN = /^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

/** Returns the pack ids a source file needs, in no particular order. */
export function requiredPacks(source: string): string[] {
  const packs = new Set<string>();
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const module = match[1];
    if (module === undefined) continue;
    const pack = PACK_BY_MODULE.get(module);
    if (pack) packs.add(pack);
  }
  return [...packs];
}

/** Pyodide package names to load for a given source file. */
export function requiredPyodidePackages(source: string): string[] {
  return requiredPacks(source);
}
