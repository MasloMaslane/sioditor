# LLVM patch series for wasm32-wasip1

LLVM does not cross-compile to WASI unmodified. These are **compile** errors, not link
errors, so they cannot be papered over with stub symbols — the declarations are absent.

Verified against the shipped `wasi-sysroot-34.0`:

- `include/wasm32-wasip1/unistd.h` puts `fork`, `execve`, `execv`, `vfork`, `getppid`
  and `getsid` inside `#ifdef __wasilibc_unmodified_upstream`, which is never defined.
- There is no `spawn.h` and no `sys/wait.h` anywhere in the sysroot.
- `include/wasm32-wasip1/setjmp.h` `#error`s outright unless
  `__wasm_exception_handling__` is defined.

Patches, in order:

| File                                   | Target                                      | Why                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001-Program.inc-wasi.patch`          | `llvm/lib/Support/Unix/Program.inc`         | `posix_spawn`, `fork`, `execve`, `getrlimit(RLIMIT_DATA)`. Make `ExecuteAndWait`/`ExecuteNoWait` return an error under `__wasi__`.                                    |
| `0002-CrashRecoveryContext-wasi.patch` | `llvm/lib/Support/CrashRecoveryContext.cpp` | Uses `sigaction`/`sigprocmask` (declared but **not defined** — they are absent from `libwasi-emulated-signal.a`) and a bare `setjmp`. Reduce to `Fn(); return true;`. |
| `0003-Signals.inc-wasi.patch`          | `llvm/lib/Support/Unix/Signals.inc`         | `sigaltstack`, `sigaction`, `backtrace`. `LLVM_ENABLE_BACKTRACES=OFF` does not remove all of it.                                                                      |
| `0004-LockFileManager-getsid.patch`    | `llvm/lib/Support/LockFileManager.cpp`      | The tree's only `getsid` call.                                                                                                                                        |
| `0005-Process.inc-wasi.patch`          | `llvm/lib/Support/Unix/Process.inc`         | `getrlimit(RLIMIT_CORE)`, `sigprocmask`.                                                                                                                              |
| `0006-clang-Stack-wasi.patch`          | `clang/lib/Basic/Stack.cpp`                 | With threads off `runOnNewStack` cannot grow the stack, so the "stack nearly exhausted" recovery is gone and only a spurious warning remains.                         |

## Why dropping CrashRecoveryContext is acceptable

A clang internal error becomes a wasm trap that kills the instance. That is fine here: a
fresh instance is created per compile anyway, and the UI reports an internal compiler
error. The alternative — building the whole 60 MB module with `-fwasm-exceptions
-mllvm -wasm-enable-sjlj` — costs size and speed everywhere to service a path that
should never run.

## Status

**Not yet written.** The build scripts and CI workflow are in place and the sysroot
packer is verified against the real sysroot, but the patch series and the LLVM build
itself are unrun. See `docs/toolchain.md` for the staged plan and the fallback.
