/*
 * Definitions for the prototypes in wasi-compat.h. See that file for why this exists and
 * for the compile-probe results that determined the list.
 *
 * Semantics: a WASI module is a single process that receives no signals and has no
 * resource limits, so these fail or no-op honestly rather than pretending to work.
 * Nothing on the compile path depends on any of them succeeding - LLVM installs crash
 * handlers it will never receive, and reads rlimits only to suppress core dumps that
 * cannot happen here.
 */

#include "wasi-compat.h"

#if defined(__wasi__)

#include <errno.h>

int sigaction(int signum, const struct sigaction *act, struct sigaction *oldact) {
  (void)signum;
  (void)act;
  if (oldact) {
    struct sigaction empty;
    __builtin_memset(&empty, 0, sizeof empty);
    *oldact = empty;
  }
  /* Succeeds. LLVM registers handlers unconditionally and ignores the result; returning
   * an error would only add noise on a path that can never fire. */
  return 0;
}

int sigaltstack(const stack_t *ss, stack_t *old_ss) {
  (void)ss;
  if (old_ss) {
    stack_t empty;
    __builtin_memset(&empty, 0, sizeof empty);
    empty.ss_flags = SS_DISABLE;
    *old_ss = empty;
  }
  return 0;
}

int sigprocmask(int how, const sigset_t *set, sigset_t *oldset) {
  (void)how;
  (void)set;
  if (oldset)
    __builtin_memset(oldset, 0, sizeof *oldset);
  return 0;
}

int sigemptyset(sigset_t *set) {
  if (set)
    __builtin_memset(set, 0, sizeof *set);
  return 0;
}

int sigfillset(sigset_t *set) {
  if (set)
    __builtin_memset(set, 0xff, sizeof *set);
  return 0;
}

int sigaddset(sigset_t *set, int signum) {
  (void)set;
  (void)signum;
  return 0;
}

int sigdelset(sigset_t *set, int signum) {
  (void)set;
  (void)signum;
  return 0;
}

int sigismember(const sigset_t *set, int signum) {
  (void)set;
  (void)signum;
  return 0;
}

/*
 * A wasm module's memory ceiling comes from --max-memory at link time, not from rlimits.
 * "Unlimited" is the closest true answer.
 */
int getrlimit(int resource, struct rlimit *rlim) {
  (void)resource;
  if (!rlim) {
    errno = EFAULT;
    return -1;
  }
  rlim->rlim_cur = RLIM_INFINITY;
  rlim->rlim_max = RLIM_INFINITY;
  return 0;
}

int setrlimit(int resource, const struct rlimit *rlim) {
  (void)resource;
  (void)rlim;
  return 0;
}

#endif /* __wasi__ */
