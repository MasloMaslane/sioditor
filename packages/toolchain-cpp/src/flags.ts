/**
 * The blessed compile configuration.
 *
 * Kept as one frozen set rather than something the UI can vary, because the precompiled
 * header is keyed to the exact clang revision, target triple and language options. A
 * second flag combination means a second PCH, and a PCH is the single largest lever we
 * have on compile latency.
 */
export const CPP_STANDARD = 'c++23';
export const TARGET_TRIPLE = 'wasm32-wasip1';

/** Where the packed sysroot image is mounted inside the compiler's virtual filesystem. */
export const SYSROOT = '/sysroot';

/**
 * wasm-ld defaults the shadow stack to 64 KiB, which a recursive solution blows through
 * almost immediately. This is the linear-memory stack for address-taken locals; it is a
 * different thing from the engine's own call stack, which a page cannot resize at all
 * (see portability.ts).
 */
export const USER_STACK_BYTES = 32 * 1024 * 1024;

export interface CompileFlagOptions {
  /** Hard ceiling on the compiled program's linear memory. */
  readonly memoryLimitBytes: number;
}

export function compileArgs(input: string, output: string): string[] {
  return [
    'clang',
    '-cc1',
    '-triple',
    TARGET_TRIPLE,
    '-emit-obj',
    '-O2',
    `-std=${CPP_STANDARD}`,
    '-fwasm-exceptions',
    // Nothing is discovered at runtime: every search path is stated, so clang performs no
    // speculative stats against directories the virtual filesystem does not have.
    '-nostdsysteminc',
    '-internal-isystem',
    `${SYSROOT}/include/c++/v1`,
    '-internal-isystem',
    `${SYSROOT}/include/clang`,
    '-internal-isystem',
    `${SYSROOT}/include`,
    '-o',
    output,
    '-x',
    'c++',
    input,
  ];
}

export function linkArgs(input: string, output: string, options: CompileFlagOptions): string[] {
  const pages = Math.max(1, Math.floor(options.memoryLimitBytes / 65_536));
  return [
    'lld',
    '-flavor',
    'wasm',
    `${SYSROOT}/lib/crt1.o`,
    input,
    '-L',
    `${SYSROOT}/lib`,
    '-lc',
    '-lc++',
    '-lc++abi',
    // __int128 lowers to __multi3, which lives here. Omitting it fails at link with an
    // error that gives no hint about the cause.
    '-lclang_rt.builtins',
    `-z`,
    `stack-size=${USER_STACK_BYTES}`,
    '--max-memory=' + pages * 65_536,
    '-o',
    output,
  ];
}
