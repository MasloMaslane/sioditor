#!/usr/bin/env bash
# Stage B: cross-compile clang + lld to a single wasm32-wasip1 module.
#
# One multicall `llvm.wasm` rather than separate clang.wasm and wasm-ld.wasm. They share
# LLVMSupport, LLVMObject, LLVMBinaryFormat and the WebAssembly backend, so shipping both
# separately duplicates all of it. One module also means one download, one brotli payload
# and one entry in Chrome's wasm code cache, which is keyed on resource URL.
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
  -O2 -c "$here/wasi-compat/wasi-compat.c" -o "$compat_obj"

cflags=(
  -D_WASI_EMULATED_SIGNAL
  -D_WASI_EMULATED_MMAN
  -D_WASI_EMULATED_GETPID
  -D_WASI_EMULATED_PROCESS_CLOCKS
  -include "$here/wasi-compat/wasi-compat.h"
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
  -DCLANG_BUILD_TOOLS=OFF \
  -DCLANG_INCLUDE_TESTS=OFF \
  -DCLANG_INCLUDE_DOCS=OFF \
  -DCLANG_DEFAULT_CXX_STDLIB=libc++ \
  -DCLANG_DEFAULT_RTLIB=compiler-rt \
  -DCLANG_DEFAULT_LINKER=wasm-ld \
  -DDEFAULT_SYSROOT=/sysroot \
  \
  -DLLVM_TOOL_LLVM_DRIVER_BUILD=ON \
  -DLLVM_PARALLEL_LINK_JOBS=1

ninja -C "$build" llvm-driver
ls -l "$build/bin/llvm.wasm"
