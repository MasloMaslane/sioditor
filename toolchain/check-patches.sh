#!/usr/bin/env bash
# Confirms the WASI patch series still applies to the pinned LLVM.
#
# A script rather than inline workflow steps so that what CI runs and what a developer
# runs are the same command. The first version of this lived in the workflow and passed
# locally while failing in CI, because `git -C <dir> apply <relative path>` resolves the
# patch path against <dir>, not the working directory - the local run happened to use
# absolute paths and so hid the bug.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/versions.env"

checkout="${1:-$(mktemp -d)/llvm}"

if [[ ! -d $checkout ]]; then
  echo "cloning $LLVM_TAG (sparse: only the paths the series touches)"
  git clone --depth 1 --branch "$LLVM_TAG" --filter=blob:none --sparse \
    https://github.com/llvm/llvm-project.git "$checkout"
  git -C "$checkout" sparse-checkout set llvm/lib/Support
fi

shopt -s nullglob
patches=("$here"/patches/*.patch)   # absolute, deliberately
shopt -u nullglob

if [[ ${#patches[@]} -eq 0 ]]; then
  echo "no patches in $here/patches - see patches/README.md" >&2
  exit 1
fi

git -C "$checkout" apply --check --verbose "${patches[@]}"
echo "${#patches[@]} patch(es) apply cleanly to $LLVM_TAG"
