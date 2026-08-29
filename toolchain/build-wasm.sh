#!/usr/bin/env bash
# Stage B: cross-compile clang and lld to wasm32-wasip1.
#
# Two binaries rather than the multicall `llvm` driver. The driver looked attractive -
# clang and lld share LLVMSupport, LLVMObject and the WebAssembly backend, so one module
# would avoid duplicating them - but it collects every tool that declares GENERATE_DRIVER,
# some twenty of them (llvm-ar, objdump, readobj, nm and friends). None of those are on a
# compile-and-link path, and bundling them inflates exactly the number this build exists
# to measure. It also cannot coexist with LLVM_BUILD_TOOLS=OFF: the driver still emits
# tool symlinks for targets that were never created, and generation fails.
#
# Two binaries is also the route every previous wasm-clang took. Revisit the driver as a
# size optimisation later, with real numbers to compare against.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${LLVM_SRC:-$here/llvm-project}"
build="${WASM_BUILD:-$here/build/wasm}"
host_bin="${HOST_BUILD:-$here/build/host}/bin"
: "${WASI_SDK:?set WASI_SDK to an extracted wasi-sdk installation}"
export WASI_SDK

# wasi-libc gates several POSIX facilities behind these macros and supplies emulation
# libraries for them. Without the -D the headers do not declare the symbols at all.
# Build the compat stubs first: Signals.inc and Process.inc reference POSIX signal and
# rlimit APIs that wasi-libc withholds *including their types*, so they fail to compile,
# not merely to link. A force-included prelude plus one object fixes both without
# patching several dozen call sites in LLVM. See toolchain/wasi-compat/wasi-compat.h.
compat_obj="$build/wasi-compat.o"
mkdir -p "$build"
"$WASI_SDK/bin/clang" --target=wasm32-wasip1 \
  -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN \
  -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_PROCESS_CLOCKS \
  -idirafter "$here/wasi-compat/include" \
  -O2 -c "$here/wasi-compat/wasi-compat.c" -o "$compat_obj"

cflags=(
  # clang/Support/Compiler.h picks its visibility macros from a chain of platform tests,
  # and its wasm branch tests __WASM__ - uppercase - which nothing defines; clang predefines
  # __wasm__. So on wasm no branch matches, CLANG_ABI is left undefined, and every class in
  # the generated Attrs.inc fails to parse. That is an upstream bug in LLVM 23.
  #
  # CLANG_BUILD_STATIC is the intended knob for a fully static build and makes all of those
  # macros empty, which is correct here: BUILD_SHARED_LIBS and LLVM_BUILD_LLVM_DYLIB are
  # both off. Fixing it this way rather than by defining __WASM__ ourselves.
  -DCLANG_BUILD_STATIC
  -D_WASI_EMULATED_SIGNAL
  -D_WASI_EMULATED_MMAN
  -D_WASI_EMULATED_GETPID
  -D_WASI_EMULATED_PROCESS_CLOCKS
  -include "$here/wasi-compat/wasi-compat.h"
  # -idirafter, not -I: these are stand-ins for headers wasi-libc lacks, and a real one
  # must always win if a future wasi-sdk grows it.
  -idirafter "$here/wasi-compat/include"
  -fno-exceptions -fno-rtti
  -fno-unwind-tables -fno-asynchronous-unwind-tables
)

ldflags=(
  "$compat_obj"
  -lwasi-emulated-signal
  -lwasi-emulated-mman
  -lwasi-emulated-getpid
  -lwasi-emulated-process-clocks
  # With threads off, llvm::thread runs callables inline, so runOnNewStack cannot hand
  # clang a bigger stack when it recurses on deep templates. The whole stack must be
  # reserved up front. wasm-ld's default is 64 KiB, which clang blows through instantly.
  -Wl,-z,stack-size=16777216
  -Wl,--initial-memory=134217728
  -Wl,--max-memory=4294901760
  -Wl,--strip-all
)

cmake -G Ninja -S "$src/llvm" -B "$build" \
  -DCMAKE_TOOLCHAIN_FILE="$here/cmake/wasi-llvm.cmake" \
  -DWASI_SDK="$WASI_SDK" \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DCMAKE_C_FLAGS="${cflags[*]}" \
  -DCMAKE_CXX_FLAGS="${cflags[*]}" \
  -DCMAKE_EXE_LINKER_FLAGS="${ldflags[*]}" \
  \
  -DLLVM_NATIVE_TOOL_DIR="$host_bin" \
  -DLLVM_TABLEGEN="$host_bin/llvm-tblgen" \
  -DLLVM_MIN_TABLEGEN="$host_bin/llvm-min-tblgen" \
  -DCLANG_TABLEGEN="$host_bin/clang-tblgen" \
  \
  -DLLVM_ENABLE_PROJECTS="clang;lld" \
  -DLLVM_TARGETS_TO_BUILD="WebAssembly" \
  -DLLVM_DEFAULT_TARGET_TRIPLE="wasm32-wasip1" \
  -DLLVM_HOST_TRIPLE="wasm32-wasip1" \
  -DLLVM_TARGET_ARCH="wasm32" \
  \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_ENABLE_ASSERTIONS=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF \
  -DLLVM_ENABLE_CRASH_OVERRIDES=OFF \
  -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_CURL=OFF \
  -DLLVM_ENABLE_HTTPLIB=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF \
  -DLLVM_ENABLE_ICONV=OFF \
  -DLLVM_ENABLE_PLUGINS=OFF \
  -DLLVM_ENABLE_BINDINGS=OFF \
  -DLLVM_ENABLE_OCAMLDOC=OFF \
  -DLLVM_ENABLE_RTTI=OFF \
  -DLLVM_ENABLE_EH=OFF \
  -DLLVM_ENABLE_DUMP=OFF \
  \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_UTILS=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_BUILD_TOOLS=OFF \
  -DLLVM_BUILD_UTILS=OFF \
  -DLLVM_BUILD_RUNTIME=OFF \
  -DLLVM_BUILD_LLVM_DYLIB=OFF \
  -DLLVM_LINK_LLVM_DYLIB=OFF \
  -DBUILD_SHARED_LIBS=OFF \
  \
  -DCLANG_ENABLE_STATIC_ANALYZER=OFF \
  -DCLANG_ENABLE_ARCMT=OFF \
  -DCLANG_ENABLE_OBJC_REWRITER=OFF \
  -DCLANG_PLUGIN_SUPPORT=OFF \
  -DCLANG_BUILD_TOOLS=ON \
  -DCLANG_INCLUDE_TESTS=OFF \
  -DCLANG_INCLUDE_DOCS=OFF \
  -DCLANG_DEFAULT_CXX_STDLIB=libc++ \
  -DCLANG_DEFAULT_RTLIB=compiler-rt \
  -DCLANG_DEFAULT_LINKER=wasm-ld \
  -DDEFAULT_SYSROOT=/sysroot \
  \
  -DLLVM_PARALLEL_LINK_JOBS=1

ninja -C "$build" clang lld
ls -l "$build"/bin/*.wasm
