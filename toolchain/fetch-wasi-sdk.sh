#!/usr/bin/env bash
# Downloads and extracts the wasi-sdk build matching this host.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/versions.env"
# shellcheck source=/dev/null
source "$here/host.sh"

dest="${1:-$here/wasi-sdk}"
platform="$(wasi_sdk_platform)"
major="${WASI_SDK_VERSION%%.*}"
url="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${major}/wasi-sdk-${WASI_SDK_VERSION}-${platform}.tar.gz"

if [[ -x $dest/bin/clang ]]; then
  echo "wasi-sdk already present at $dest"
  exit 0
fi

echo "fetching wasi-sdk ${WASI_SDK_VERSION} for ${platform}"
mkdir -p "$dest"
curl -sSL "$url" | tar xz -C "$dest" --strip-components=1
"$dest/bin/clang" --version | head -1
