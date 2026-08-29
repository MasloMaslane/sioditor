# LLVM patch series for wasm32-wasip1

LLVM does not cross-compile to WASI unmodified. Everything here was established by
**compile probes against wasi-sdk-34**, not by reading headers — reading them is actively
misleading, because the declarations _are_ present in the files but sealed inside
`#ifdef __wasilibc_unmodified_upstream`, which is never defined.

What wasi-sysroot-34.0 actually gives you:

|                                  |                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| available                        | `signal()`, the `SIG*` numbers, `pid_t`, `size_t`, `struct timespec`                                            |
| absent                           | `fork`, `vfork`, `execve`, `execv`, `getsid`, `getppid`                                                         |
| absent                           | `sigaction`, `sigaltstack`, `sigprocmask`, `sigemptyset`, `sigfillset`, `sigaddset`, `sigdelset`, `sigismember` |
| absent                           | `getrlimit`, `setrlimit`                                                                                        |
| absent, and this is the surprise | the **types** `sigset_t`, `struct sigaction`, `stack_t`, `struct rlimit`                                        |
| hard `#error`                    | `<setjmp.h>`, unless built with `-mllvm -wasm-enable-sjlj`                                                      |
| missing entirely                 | `<spawn.h>`, `<sys/wait.h>`, `<execinfo.h>`                                                                     |

Because the _types_ are missing, the affected code fails to **compile**. Stub definitions
alone would not have been enough.

## Two mechanisms, deliberately

**Most of it needs no patch.** `toolchain/wasi-compat/` supplies the missing types and
prototypes through a force-included prelude (`-include wasi-compat.h`) and their
definitions through one object file. That covers `Signals.inc` and `Process.inc`
completely — several dozen call sites that would otherwise each need editing, and
re-editing on every LLVM upgrade.

**Three files still need real patches**, because no header can fix them:

| Patch                                             | Why a prelude cannot help                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `0001-Program.inc-no-fork-exec-on-wasi.patch`     | The `fork`/`execve` path must be _removed_, not satisfied. Declaring `fork` would just move the failure to runtime. |
| `0002-CrashRecoveryContext-disable-on-wasi.patch` | `<setjmp.h>` `#error`s on include, and crash recovery is built on `setjmp`.                                         |
| `0003-LockFileManager-no-getsid-on-wasi.patch`    | The `getsid` call is load-bearing logic, so it needs a different answer rather than a stub.                         |

All three are verified to apply cleanly to `llvmorg-23.1.0`.

## Why disabling crash recovery is acceptable

A clang internal error becomes a wasm trap that kills the instance. That is fine: the
browser host builds a fresh instance per compile and reports an internal compiler error
to the user. The alternative — building the whole ~60 MB module with `-fwasm-exceptions
-mllvm -wasm-enable-sjlj` — would cost size and speed everywhere to service a path that
should never execute.

## Status

Patches apply cleanly and the compat layer is verified: it compiles, it exports all ten
symbols, and a file reproducing the real `Signals.inc`/`Process.inc` call patterns goes
from 20 compile errors to zero and links with no undefined symbols.

**The full LLVM build has not been run.** That is the next gate — see `docs/toolchain.md`.
