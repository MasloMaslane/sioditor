#!/usr/bin/env bash
# Compiles and runs the OI corpus against the wasi-sdk toolchain.
#
# These are correctness cross-checks for the GNU compatibility shims, not tests of the
# browser plumbing - they run natively under wasmtime because that loop is seconds rather
# than minutes. The browser path is covered by e2e/cpp.spec.ts.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$here/../.."
wasi_sdk="${WASI_SDK:-$repo/toolchain/wasi-sdk}"

if [[ ! -x $wasi_sdk/bin/clang++ ]]; then
  echo "no wasi-sdk at $wasi_sdk - run toolchain/fetch-wasi-sdk.sh" >&2
  exit 1
fi
command -v wasmtime >/dev/null || { echo "wasmtime is needed to run the corpus" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

status=0
for source in "$here"/*.cpp; do
  name="$(basename "$source" .cpp)"
  printf '%-12s ' "$name"

  # The same shape flags.ts passes in the browser: no exceptions, the GNU compat headers
  # ahead of libc++, and a generous stack for recursive solutions.
  if ! "$wasi_sdk/bin/clang++" --target=wasm32-wasip1 -O2 -std=c++23 -fno-exceptions \
      -D_WASI_EMULATED_SIGNAL -I "$repo/packages/gnu-compat/include" \
      -Wl,-z,stack-size=33554432 \
      "$source" -o "$work/$name.wasm" -lwasi-emulated-signal 2>"$work/$name.err"; then
    echo "COMPILE FAILED"
    sed 's/^/    /' "$work/$name.err" | head -20
    status=1
    continue
  fi

  if output="$(wasmtime run "$work/$name.wasm" 2>&1)"; then
    echo "ok - $output"
  else
    echo "FAILED"
    sed 's/^/    /' <<<"$output" | head -20
    status=1
  fi
done

exit $status
