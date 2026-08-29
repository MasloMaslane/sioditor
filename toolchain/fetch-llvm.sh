#!/usr/bin/env bash
# Clones the pinned LLVM and applies the WASI patch series.
#
# Split out of the workflow so both jobs use identical sources, and so the patch step
# fails with something readable. A bare `git apply patches/*.patch` reports
# "can't open patch" when the directory is empty, which says nothing about the cause.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/versions.env"

src="${LLVM_SRC:-$here/llvm-project}"

if [[ ! -d $src ]]; then
  git clone --depth 1 --branch "$LLVM_TAG" https://github.com/llvm/llvm-project.git "$src"
fi

shopt -s nullglob
patches=("$here"/patches/*.patch)
shopt -u nullglob

if [[ ${#patches[@]} -eq 0 ]]; then
  cat >&2 <<'MSG'
No patches found in toolchain/patches/.

LLVM does not cross-compile to wasm32-wasip1 unmodified: fork, execve and getsid are
undeclared in wasi-libc, and setjmp.h is a hard #error. Those are compile failures, so
the build cannot proceed without the series. See toolchain/patches/README.md.
MSG
  exit 1
fi

echo "applying ${#patches[@]} patch(es) to $src"
git -C "$src" apply --verbose "${patches[@]}"
