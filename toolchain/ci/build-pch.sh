#!/usr/bin/env bash
# Builds the precompiled <bits/stdc++.h> that ships as the "szybka kompilacja" pack.
#
# Built by the wasm clang itself, against the packed sysroot expanded at the exact path
# the browser mounts it (/sysroot). Both matter: a PCH is tied to the compiler revision
# and language options that produced it, and it records the path of every header it
# consumed, so building it against a different layout makes it silently unusable.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$here/../.."
image="${1:-$repo/toolchain/out/sysroot.bin}"
clang="${CLANG_WASM:-$repo/toolchain/build/wasm/bin/clang.wasm-23}"
out="${2:-$repo/toolchain/out/stdcpp.pch}"

[[ -f $image ]] || { echo "no sysroot image at $image - run pack-sysroot.mjs" >&2; exit 1; }
[[ -f $clang ]] || { echo "no clang.wasm at $clang - run build-wasm.sh" >&2; exit 1; }
command -v wasmtime >/dev/null || { echo "wasmtime is required" >&2; exit 1; }

work="$(mktemp -d)"
sysroot="$(mktemp -d)"
trap 'rm -rf "$work" "$sysroot"' EXIT

node "$here/unpack-sysroot.mjs" "$image" "$sysroot" >/dev/null
printf '#include <bits/stdc++.h>\n' > "$work/prefix.hpp"

# The flag set must match packages/toolchain-cpp/src/flags.ts exactly; clang rejects a PCH
# built with different language options.
wasmtime run --dir "$work::/work" --dir "$sysroot::/sysroot" --env TMPDIR=/work "$clang" \
  -cc1 -triple wasm32-wasip1 -emit-pch -O2 -std=c++23 \
  -D_WASI_EMULATED_SIGNAL -fno-color-diagnostics \
  -internal-isystem /sysroot/include/c++/v1 \
  -internal-isystem /sysroot/include/clang \
  -internal-isystem /sysroot/include \
  -o /work/stdcpp.pch -x c++-header /work/prefix.hpp

mkdir -p "$(dirname "$out")"
cp "$work/stdcpp.pch" "$out"
echo "stdcpp.pch: $(( $(stat -f%z "$out" 2>/dev/null || stat -c%s "$out") / 1048576 )) MB"
