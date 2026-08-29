#!/usr/bin/env bash
# Runs the whole toolchain build on this machine, start to finish.
#
# Intended for a developer laptop, where this is far quicker than CI: an Apple Silicon
# machine with 8-12 performance cores should finish in roughly an hour against the 3-5
# hours a 4-vCPU runner takes, and it has no 6-hour job cap to run into. The wasm output
# is identical either way - the host only affects the throwaway native TableGen binaries.
#
#   ./toolchain/build-local.sh
#
# Needs ~30 GB free, cmake, ninja and a working host compiler (Xcode CLT on macOS).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/host.sh"
# shellcheck source=/dev/null
source "$here/versions.env"

for tool in cmake ninja git curl; do
  command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }
done

echo "==> host: $(wasi_sdk_platform), $(cpu_count) cpus"

# macOS defaults to a case-insensitive filesystem, which LLVM has historically tripped
# over. Warn rather than refuse: it usually works, and a baffling "no such file" on a
# header that plainly exists is the symptom to connect back to this.
if [[ "$(uname -s)" == Darwin ]]; then
  probe="$here/.case-probe"
  rm -f "$probe" "${probe^^}" 2>/dev/null || true
  touch "$probe"
  if [[ -e "${probe%/*}/.CASE-PROBE" ]]; then
    echo "!!  This filesystem is case-insensitive. LLVM usually builds anyway, but if you"
    echo "!!  hit a missing-header error for a file that clearly exists, that is why."
  fi
  rm -f "$probe"
fi

export WASI_SDK="${WASI_SDK:-$here/wasi-sdk}"
"$here/fetch-wasi-sdk.sh" "$WASI_SDK"
"$here/fetch-llvm.sh"

echo "==> stage A: native TableGen"
"$here/build-host-tools.sh"

echo "==> stage B: cross-building clang + lld to wasm32-wasip1"
"$here/build-wasm.sh"

echo "==> packing the sysroot"
mkdir -p "$here/out"
node "$here/ci/pack-sysroot.mjs" "$WASI_SDK/share/wasi-sysroot" "$here/out"
cp "$here/build/wasm/bin/llvm.wasm" "$here/out/"

echo
echo "==> artifacts"
for f in "$here"/out/*; do
  printf "    %-16s %8.1f MB\n" "$(basename "$f")" "$(echo "$(file_size "$f") / 1048576" | bc -l)"
done
echo
echo "The number that decides the approach is llvm.wasm above."
echo "Under 60 MB is comfortable; over 90 MB means re-scoping. See docs/toolchain.md."
