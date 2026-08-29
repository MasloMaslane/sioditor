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

## Blockers, verified against wasi-sysroot-34.0

I checked these against the shipped tarball rather than taking them on trust:

- `fork`, `execve`, `execv`, `vfork`, `getppid`, `getsid` are all inside
  `#ifdef __wasilibc_unmodified_upstream` in `unistd.h` — **not declared**.
- No `spawn.h`, no `sys/wait.h` anywhere in the sysroot.
- `setjmp.h` `#error`s unless `__wasm_exception_handling__` is defined.

These are compile errors, so a patch series is mandatory, not optional. See
`toolchain/patches/README.md`.

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

**Still unmeasured, and it decides the project: the size of `llvm.wasm` for LLVM 23.**
For reference, binji's 2019 LLVM-9 build was 31.2 MB for clang alone plus 19.5 MB for
lld. Estimate for a merged LLVM-23 module is 55–75 MB raw / 14–19 MB brotli, but that is
an extrapolation across fourteen releases. Measure it before building anything on top.

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
