#!/usr/bin/env bash
# Proves the compat layer does its job, without needing a full LLVM build.
#
# Three claims, each checked rather than asserted:
#   1. the stubs compile and export every symbol they promise
#   2. code using the real Signals.inc / Process.inc patterns does NOT compile without
#      the prelude - if this ever starts passing, wasi-libc grew the APIs and this whole
#      layer should be reconsidered
#   3. the same code compiles and links cleanly with the prelude and the stubs
set -euo pipefail

wasi_sdk="${1:-${WASI_SDK:-/opt/wasi-sdk}}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$here/../host.sh"
clang="$wasi_sdk/bin/clang"
clangxx="$wasi_sdk/bin/clang++"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

flags=(--target=wasm32-wasip1
  -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN
  -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_PROCESS_CLOCKS
  -idirafter "$here/include")

echo "1/3 compiling the stubs"
"$clang" "${flags[@]}" -O2 -Wall -Wextra -c "$here/wasi-compat.c" -o "$work/compat.o"

expected=(sigaction sigaltstack sigprocmask sigemptyset sigfillset sigaddset sigdelset
          sigismember getrlimit setrlimit)
symbols="$("$wasi_sdk/bin/llvm-nm" --defined-only "$work/compat.o")"
for symbol in "${expected[@]}"; do
  grep -qE "\b$symbol\$" <<<"$symbols" || { echo "  missing symbol: $symbol"; exit 1; }
done
echo "    all ${#expected[@]} symbols exported"

cat > "$work/usage.cpp" <<'EOF'
#include <signal.h>
#include <sys/resource.h>
#include <cstddef>
static void handler(int) {}
static void sigHandler(int, siginfo_t *, void *) {}
struct RegisteredSignalInfo { int SigNo; struct sigaction SA; };
static RegisteredSignalInfo Registered[16];
void altStack() {
  stack_t OldAltStack, AltStack;
  if (sigaltstack(nullptr, &OldAltStack) != 0 || OldAltStack.ss_flags & SS_ONSTACK) return;
  AltStack.ss_sp = nullptr; AltStack.ss_size = 8192; AltStack.ss_flags = 0;
  sigaltstack(&AltStack, &OldAltStack);
}
void registerHandlers(int Signal, unsigned Index) {
  struct sigaction NewHandler;
  NewHandler.sa_handler = handler;
  NewHandler.sa_sigaction = sigHandler;
  NewHandler.sa_flags = SA_NODEFER | SA_RESETHAND | SA_ONSTACK;
  sigemptyset(&NewHandler.sa_mask);
  struct sigaction act;
  if (sigaction(Signal, nullptr, &act) == 0 && act.sa_handler != SIG_IGN)
    sigaction(Signal, &NewHandler, &Registered[Index].SA);
  sigaction(Registered[Index].SigNo, &Registered[Index].SA, nullptr);
}
void unblock(int Signal) {
  sigset_t SigMask; sigemptyset(&SigMask); sigaddset(&SigMask, Signal);
  sigprocmask(SIG_UNBLOCK, &SigMask, nullptr);
}
void limits() {
  struct rlimit rlim;
  getrlimit(RLIMIT_CORE, &rlim);
  rlim.rlim_cur = 0;
  setrlimit(RLIMIT_CORE, &rlim);
  sigset_t FullSet, SavedSet;
  sigfillset(&FullSet);
  sigprocmask(SIG_SETMASK, &FullSet, &SavedSet);
  sigprocmask(SIG_SETMASK, &SavedSet, nullptr);
}
EOF

echo "2/3 confirming the prelude is still needed"
if "$clangxx" "${flags[@]}" -fsyntax-only "$work/usage.cpp" >/dev/null 2>&1; then
  echo "    wasi-libc now provides these APIs natively - revisit toolchain/wasi-compat/" >&2
  exit 1
fi
echo "    fails without it, as expected"

echo "3/3 compiling and linking with the prelude"
"$clangxx" "${flags[@]}" -include "$here/wasi-compat.h" -O2 -Wall \
  -c "$work/usage.cpp" -o "$work/usage.o"
cat > "$work/main.cpp" <<'EOF'
void altStack();
void limits();
int main() { altStack(); limits(); return 0; }
EOF
"$clangxx" "${flags[@]}" -c "$work/main.cpp" -o "$work/main.o"
"$clangxx" "${flags[@]}" \
  -lwasi-emulated-signal -lwasi-emulated-mman \
  -lwasi-emulated-getpid -lwasi-emulated-process-clocks \
  "$work/main.o" "$work/usage.o" "$work/compat.o" -o "$work/probe.wasm"
echo "    linked $(file_size "$work/probe.wasm") bytes with no undefined symbols"

echo "wasi-compat verified"
