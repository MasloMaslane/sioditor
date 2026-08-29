#!/usr/bin/env bash
# Host detection shared by every toolchain script.
#
# The build output is wasm32-wasip1 and so is identical whatever the host: the host only
# decides which wasi-sdk to download and which native TableGen binaries get built and then
# thrown away. An Apple Silicon laptop is a perfectly good, and much faster, place to run
# this than a 4-vCPU runner.

# Prints the wasi-sdk asset suffix for this machine, e.g. arm64-macos.
wasi_sdk_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux) os=linux ;;
    *) echo "unsupported OS: $(uname -s)" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x86_64 ;;
    *) echo "unsupported architecture: $(uname -m)" >&2; return 1 ;;
  esac
  echo "${arch}-${os}"
}

# BSD stat and GNU stat disagree on how to ask for a file size.
file_size() {
  if stat -f%z "$1" >/dev/null 2>&1; then stat -f%z "$1"; else stat -c%s "$1"; fi
}

# Physical cores, for sizing the build.
cpu_count() {
  if command -v nproc >/dev/null 2>&1; then nproc; else sysctl -n hw.ncpu 2>/dev/null || echo 4; fi
}
