# The C++ toolchain

`sioditor` compiles C++ in the browser by shipping clang itself as WebAssembly. This
document is the build recipe, the blockers, and — importantly — which numbers are
measured and which are still guesses.

## Why not g++

GCC's own WebAssembly backend was approved by the steering committee in June 2026 and
is still missing exception handling, tables and debug info. Beyond that, GCC's driver
depends on `fork`/`exec` between `cc1plus`, `as` and `collect2`, which WASI does not
provide. Real g++ in a browser is only reachable through full x86 emulation
(container2wasm/v86, or CheerpX whose engine is proprietary), at hundreds of megabytes
and emulated-CPU speed. That trade is wrong for a tool whose selling point is working
when everything else has failed.

So: clang, and an honest account of where it differs. See "Fidelity gaps" below — the
`long` one matters more than people expect.

## Shape of the build

Two stages, because LLVM needs TableGen generators that run on the build machine.

**Stage A** (`build-host-tools.sh`) builds exactly three native binaries:
`llvm-min-tblgen`, `llvm-tblgen`, `clang-tblgen`. Not a full native clang — that would
cost an hour for nothing. They must come from the same LLVM revision as stage B, since
the generated `.inc` formats change between releases.

**Stage B** (`build-wasm.sh`) cross-compiles clang + lld to `wasm32-wasip1` against the
wasi-sdk sysroot, into a **single multicall `llvm.wasm`** rather than separate
`clang.wasm` and `wasm-ld.wasm`. They share LLVMSupport, LLVMObject, LLVMBinaryFormat
and the WebAssembly backend; shipping both separately duplicates all of it. One module
also means one brotli payload and one entry in Chrome's wasm code cache, which is keyed
on resource URL.

Dispatch at runtime is `llvm clang -cc1 …` then `llvm lld -flavor wasm …`.

### Two non-obvious CMake settings

`cmake/wasi-llvm.cmake` sets `UNIX 1`. Without it, `HandleLLVMOptions.cmake` falls
through its `WIN32 / UNIX / Generic` dispatch and calls
`message(SEND_ERROR "Unable to determine platform")`. Claiming UNIX also selects LLVM's
`Unix/*.inc` sources, which are much closer to wasi-libc than the no-platform path.

It also sets `CMAKE_AR=llvm-ar`. GNU `ar` cannot write a symbol index for wasm objects,
and the failure surfaces far away as `undefined symbol: vtable for llvm::cl::OptionValue`.

## Blockers, established by compile probes

Reading wasi-libc's headers is misleading: the declarations are physically present but
sealed inside `#ifdef __wasilibc_unmodified_upstream`, which is never defined. So these
were determined by compiling probes against wasi-sdk-34, not by grepping.

|               |                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------ |
| available     | `signal()`, the `SIG*` numbers, `pid_t`, `size_t`, `struct timespec`                             |
| absent        | `fork`, `vfork`, `execve`, `execv`, `getsid`, `getppid`                                          |
| absent        | `sigaction`, `sigaltstack`, `sigprocmask`, `sigemptyset`, `sigfillset`, `sigaddset`, `sigdelset` |
| absent        | `getrlimit`, `setrlimit`                                                                         |
| absent        | the **types** `sigset_t`, `struct sigaction`, `stack_t`, `struct rlimit`                         |
| hard `#error` | `<setjmp.h>`                                                                                     |
| missing       | `<spawn.h>`, `<sys/wait.h>`, `<execinfo.h>`                                                      |

The missing _types_ are the part that matters: they mean the affected code fails to
compile, so stub definitions alone would not have been enough.

The fix is split in two. `toolchain/wasi-compat/` supplies the missing types and
prototypes via a force-included prelude and their definitions via one object, which
covers `Signals.inc` and `Process.inc` entirely — several dozen call sites that would
otherwise need patching, and re-patching on every LLVM upgrade. Only three files need
real patches: `Program.inc` (the fork path must be removed, not satisfied),
`CrashRecoveryContext.cpp` (`<setjmp.h>` `#error`s on include) and `LockFileManager.cpp`
(the `getsid` call is logic, not a stub). All three apply cleanly to `llvmorg-23.1.0`.

**Verified:** the compat layer compiles, exports all ten symbols, and takes a file
reproducing the real `Signals.inc`/`Process.inc` call patterns from 20 compile errors to
zero, linking with no undefined symbols. See `toolchain/patches/README.md`.

**`clang -c` does compile in-process.** `CLANG_SPAWN_CC1` defaults to `OFF`, so the
driver calls cc1 directly instead of spawning. But the _link_ step is a plain command
that goes through `ExecuteAndWait`, so the JS driver runs the two steps itself. Argv for
both is precomputed in `packages/toolchain-cpp/src/flags.ts` rather than discovered,
which also keeps the Driver and its toolchain detection out of the hot path.

Also note the driver selects the `noeh` libc++ multilib **unless** `-fwasm-exceptions`
is passed. wasi-sdk-34 ships both; we pass the flag and take `eh`.

## Measured numbers

Verified in this repo against the real `wasi-sysroot-34.0`:

| Thing                                      | Value                                  |
| ------------------------------------------ | -------------------------------------- |
| `sysroot.bin` (packed, `eh`, no `__cxx03`) | **22,664,950 B**, 1,330 files, 67 dirs |
| …brotli-11                                 | **3,880,089 B** (5.84×)                |
| manifest inside the image                  | 84 KB                                  |
| `libc.a`                                   | 3,245,870 B                            |
| `eh/libc++.a`                              | 9,027,614 B (`noeh` is 8,394,398 B)    |
| `eh/libc++abi.a`                           | 1,437,874 B                            |
| libc++ headers, `__cxx03` excluded         | 8,446,617 B                            |
| …`__cxx03` alone, dropped                  | 4,279,023 B                            |

Pruned from the sysroot: the `__cxx03` header tree, the entire `noeh` include tree, the
wasip2/wasip3 and threads slices, the `llvm-lto` bitcode libraries, and ~95% of clang's
resource headers (x86/ARM/GPU intrinsics).

### The gate number, measured

The build now runs. On an M-series Mac, LLVM 23.1.0:

| artifact | raw | brotli-11 |
|---|---:|---:|
| `clang.wasm` | 58.6 MB | **11.6 MB** (5.05x) |
| `lld.wasm` | 33.2 MB | **6.8 MB** (4.84x) |
| `sysroot.bin` | 22.7 MB | 3.7 MB |
| **first-visit total** | | **≈ 22 MB** |

That lands in the comfortable band. The pre-build estimate was 55-75 MB raw for a merged
module; two separate binaries came in at 91.8 MB raw / 18.5 MB compressed, which is the
same ballpark once the duplication between them is accounted for.

Stage A takes about a minute on ten cores; stage B about twenty. Under wasmtime a cold
compile of a `<bits/stdc++.h>` translation unit is ~10 s and the link ~0.3 s - the compile
figure is why the precompiled header matters, not a reason to doubt the approach.

### It works, end to end

Verified by actually running it, not by inspection:

```
$ wasmtime run ... clang.wasm -cc1 -triple wasm32-wasip1 -O2 -std=c++23 ... -o oi.o oi.cpp
$ wasmtime run ... lld.wasm -flavor wasm crt1.o oi.o -lc -lc++ -lc++abi -lclang_rt.builtins ...
$ wasmtime run oi.wasm
9000000000000     <- __int128 arithmetic
8 5000            <- __builtin_popcountll, and 5000-deep recursion
1 3 4             <- std::sort via <bits/stdc++.h>
4 8               <- sizeof(long)=4, sizeof(long long)=8
```

That last line is the ILP32 divergence, confirmed on a real binary rather than argued
from the ABI docs.

## Sysroot packaging

`ci/pack-sysroot.mjs` emits one indexed image:

```
[4-byte LE manifest length][UTF-8 JSON manifest][concatenated file bytes]
```

The manifest maps a virtual path to `[offset, length]`, so the VFS answers `path_open`
with a Map lookup and serves reads as subarray views — no per-file allocation, no copies.
A tar would mean parsing ~1,330 headers on every cold start; per-file HTTP would mean
1,330 requests and no offline story. Directory entries are materialised too, because
clang stats directories during header search.

## Fidelity gaps versus the judge's g++

These are in `packages/toolchain-cpp/src/portability.ts`, with tests, and surface as
editor warnings.

**`long` is 32 bits here.** wasm32 is ILP32; the judge's x86-64 Linux g++ is LP64. A
solution using `long` for anything above 2^31 overflows in this editor and passes on the
judge, or the reverse. This is the highest-value divergence to catch precisely because
the code compiles cleanly. `long long` and `int64_t` are 64-bit on both sides.

**Recursion tops out around 3–8k frames.** Two separate stacks are in play. The
linear-memory shadow stack is `-z stack-size` and we set it generously (32 MB). The
engine's own call stack, which holds wasm frames, is roughly 1 MB and **a page cannot
resize it**. Measured depths on V8 with a realistic frame: ~17,888 frames at 0 locals,
8,347 at 8×i64, 3,209 at 32×i64. A judge allows on the order of 10^6. A correct deep DFS
will still fail here, so the runner says so explicitly instead of letting a contestant
conclude their solution is broken. JSPI's growable secondary stacks (Chrome 137+,
Firefox 139+) are worth an experiment.

**`long double`** is software binary128, not x87 80-bit: more precise, much slower, and
different `numeric_limits`. Geometry tuned to x87 epsilon will behave differently.

**`<bits/stdc++.h>`** is trivial to shim — it is only an aggregate header. Guard every
entry with `__has_include` and drop what C++20/23 removed (`<ciso646>`, `<cstdbool>`,
`<cstdalign>`).

**`__gnu_pbds`** has no libc++ equivalent and no maintained port. The plan is a
clean-room ~250-line header providing `tree` with `tree_order_statistics_node_update`
(`find_by_order`, `order_of_key`) over a randomized treap, plus `gp_hash_table`. That
covers the overwhelming majority of OI use. A verbatim port of libstdc++'s `ext/pb_ds`
is possible — it depends on remarkably little (`debug/debug.h`, `bits/c++config.h`,
`ext/typelist.h`, `ext/type_traits.h`) — but it would make this repo a GPLv3
distribution point, so it stays a flagged fallback.

**Working:** `__int128` (lowers to `__multi3`, so `libclang_rt.builtins.a` must be
linked), `__builtin_popcountll`, `__builtin_ctzll`, `__builtin_clzll`.

**Not working:** `-fsanitize=address,undefined` (Emscripten has them, wasi-sdk does
not), x86 intrinsics, `#pragma GCC optimize/target` (ignored with a warning).

## Building it on your own machine

Faster than CI, and the recommended way to get the first number. The output is
`wasm32-wasip1` and therefore identical whatever the host: the host architecture only
decides which wasi-sdk is downloaded and which native TableGen binaries get built and
then discarded.

```
./toolchain/build-local.sh
```

That fetches the right wasi-sdk for the machine, clones and patches LLVM, runs both
stages, packs the sysroot, and prints the artifact sizes.

**Apple Silicon works and is a good choice.** wasi-sdk ships a native `arm64-macos`
build, so there is no Rosetta involved. Eight to twelve performance cores should finish
in roughly an hour against the 3-5 hours a 4-vCPU runner takes, with no 6-hour job cap.

Requirements: about 30 GB free, `cmake`, `ninja`, and a host compiler (Xcode Command Line
Tools on macOS).

Three macOS-specific things to know:

- **Case-insensitive filesystem.** APFS defaults to it and LLVM has historically had
  trouble there. `build-local.sh` warns if it detects one. It usually builds anyway; the
  symptom to watch for is a missing-header error naming a file that plainly exists, and
  the fix is a case-sensitive volume for the build tree.
- **CMake and Darwin flags.** CMake normally injects `-isysroot` and
  `-mmacosx-version-min` into every target. `cmake/wasi-llvm.cmake` sets
  `CMAKE_SYSTEM_NAME WASI`, which should stop the Darwin platform module applying to the
  cross build - but that path has never been exercised, so check stage B's first compile
  line.
- **Homebrew leakage.** The `LLVM_ENABLE_ZLIB=OFF` and `ZSTD=OFF` settings matter more
  here than on a bare runner: CMake will happily find Homebrew's copies and try to link
  them into a wasm binary.

## Starting the build in CI

Either press Run workflow on the `toolchain` workflow, or push a tag:

```
git tag toolchain-build-$(date +%Y%m%d-%H%M) && git push origin --tags
```

The tag route records which commit was built, which is worth having for an artifact this
expensive to produce. Note that both routes need a human or a token with `actions:write`
and tag-push rights: the automation working on this repo has neither (both return 403),
so it cannot start this build itself.

Expect 3-5 hours on a 4-vCPU runner, against a 6-hour job cap. If it starts timing out,
move to a larger runner rather than trimming the build.

## Staged plan, with a gate at each step

1. **Plumbing first, no build.** Wire the WASI shim and packed-image VFS in a worker and
   drive binji's prebuilt LLVM-9 clang through a C hello world. Proves our JS before
   entering a multi-hour build loop.
2. **The size gate.** Run the full two-stage build and get a number for `llvm.wasm`.
   Write no further frontend code until it exists. Under 60 MB: comfortable. 60–90 MB:
   proceed with a size-reduction sprint. Over 90 MB: re-scope — a `cc1`-only binary
   without the Driver layer, or accept it as an explicit one-time install.
3. **Run under wasmtime, not a browser.** Debug the sysroot layout and the `-cc1` argv
   where there is real stderr and a ten-second loop.
4. **Stack torture test.** Deeply nested templates and long `<ranges>` pipelines; bisect
   `-z stack-size` until stable, then double it.
5. **Browser.** Worker, `instantiateStreaming` from a content-hashed immutable URL,
   fresh instance per compile. Confirm the code cache actually engages.
6. **PCH.** Roughly two thirds of a `bits/stdc++.h` compile is parsing headers, so this
   is the largest latency lever. It must be built in CI under the same `/sysroot`
   absolute paths (hence `-DDEFAULT_SYSROOT=/sysroot`) and loaded with
   `-fno-validate-pch`, since our VFS has synthetic mtimes. Fallback if it misbehaves: a
   slim `bits/stdc++.h` including only the headers OI code actually uses.
7. **Fidelity.** The shims above, against a corpus of real OI solutions diffed between
   native g++ and our wasm clang.

**Fallback if stage 2 fails outright:** ship the existing 2019-era `runno-clang`
artifacts at C++17 and revisit. Worse, but shippable.

## Startup cost, and why not Wizer

Measured on a 31 MB LLVM-9 clang under Node 22: `WebAssembly.compile` 69–75 ms lazy,
305–321 ms with eager Liftoff, 5,981 ms with full TurboFan; instantiation 7–12 ms. So
instantiation is already cheap and Wizer's win — skipping init work — is not the
bottleneck. Worse, Wizer inflates the data section, which hurts the cost that actually
dominates: download plus baseline compile.

The thing that genuinely fixes warm start is Chrome's wasm code cache. It requires
`compileStreaming`/`instantiateStreaming` on a resource of at least 128 KB, served as
`application/wasm` from a **stable** URL. Fetching into an ArrayBuffer and calling
`WebAssembly.compile` bypasses it entirely. Do not try to persist `WebAssembly.Module`
in IndexedDB — Firefox removed that in 63 and Chrome never shipped it.
