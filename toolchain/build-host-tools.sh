#!/usr/bin/env bash
# Stage A: the three TableGen generators, and nothing else.
#
# A full native clang would take an hour or more and is not needed - the cross build only
# reaches for llvm-tblgen, llvm-min-tblgen and clang-tblgen. They must come from the same
# LLVM revision as stage B, because the generated .inc formats change between releases.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${LLVM_SRC:-$here/llvm-project}"
build="${HOST_BUILD:-$here/build/host}"

cmake -G Ninja -S "$src/llvm" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS="clang" \
  -DLLVM_TARGETS_TO_BUILD="WebAssembly" \
  -DLLVM_ENABLE_ASSERTIONS=OFF \
  -DLLVM_INCLUDE_TESTS=OFF \
  -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_INCLUDE_EXAMPLES=OFF \
  -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF \
  -DLLVM_ENABLE_ZSTD=OFF \
  -DLLVM_ENABLE_LIBXML2=OFF \
  -DLLVM_ENABLE_TERMINFO=OFF \
  -DLLVM_ENABLE_LIBEDIT=OFF

ninja -C "$build" llvm-min-tblgen llvm-tblgen clang-tblgen
echo "host tools in $build/bin"
