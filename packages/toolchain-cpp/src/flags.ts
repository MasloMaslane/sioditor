/**
 * The blessed compile configuration.
 *
 * Verified end to end against the real clang.wasm and lld.wasm under wasmtime: this exact
 * argument list compiles and links a C++23 program using <bits/stdc++.h>, __int128,
 * __builtin_popcountll and 5000-deep recursion.
 *
 * Two things the first draft of this file got wrong, both caught by actually running it:
 * argv[0] is supplied by the runner and must not appear here, and -fwasm-exceptions is a
 * driver flag with no -cc1 spelling. Exceptions are therefore off for now; turning them on
 * means the `eh` libc++ multilib plus the right -cc1 exception-model flag.
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
    '-cc1',
    '-triple',
    TARGET_TRIPLE,
    '-emit-obj',
    '-O2',
    `-std=${CPP_STANDARD}`,
    // <csignal> in wasi-libc is a hard #error without this, and bits/stdc++.h pulls it in.
    // The matching -lwasi-emulated-signal is on the link line.
    '-D_WASI_EMULATED_SIGNAL',
    // Every search path is stated, so clang performs no speculative stats against
    // directories the virtual filesystem does not have.
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
    '-flavor',
    'wasm',
    `${SYSROOT}/lib/crt1.o`,
    input,
    '-L',
    `${SYSROOT}/lib`,
    '-lc',
    '-lc++',
    '-lc++abi',
    // __multi3 and friends live here. Not optional even without __int128: libc itself
    // references them, and omitting it fails at link with no hint as to why.
    '-lclang_rt.builtins',
    '-lwasi-emulated-signal',
    `-z`,
    `stack-size=${USER_STACK_BYTES}`,
    `--max-memory=${pages * 65_536}`,
    '-o',
    output,
  ];
}
