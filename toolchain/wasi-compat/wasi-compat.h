/*
 * Force-included prelude that gives LLVM the POSIX signal and rlimit surface wasi-libc
 * withholds.
 *
 * Measured against wasi-sysroot-34.0 with compile probes (not by reading headers, which
 * is misleading here - the declarations are present in the file but sealed inside
 * `#ifdef __wasilibc_unmodified_upstream`, which is never defined):
 *
 *     available: signal(), the SIG* numbers, pid_t, size_t, struct timespec
 *     absent:    sigaction, sigaltstack, sigprocmask, sigemptyset, sigaddset, sigfillset,
 *                sigdelset, sigismember, getrlimit, setrlimit, and the types
 *                sigset_t, struct sigaction, stack_t, struct rlimit
 *
 * Because the types are missing too, Signals.inc and Process.inc fail to *compile*, not
 * merely to link. Supplying them here rather than patching LLVM keeps the patch series at
 * three files instead of touching several dozen call sites - and, more importantly, keeps
 * that surface from having to be re-done on every LLVM upgrade.
 *
 * Definitions mirror musl's, which is what wasi-libc derives from, so the field names
 * LLVM uses (sa_handler, sa_sigaction, sa_mask, sa_flags) line up.
 */

#ifndef SIODITOR_WASI_COMPAT_H
#define SIODITOR_WASI_COMPAT_H

#if defined(__wasi__)

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --- signals ------------------------------------------------------------- */

/* The SIG* numbers are present; sigset_t is not. Each addition is guarded so a future
 * wasi-libc that grows these wins without a conflict. */

#ifndef __DEFINED_sigset_t
#define __DEFINED_sigset_t
typedef struct {
  unsigned long __bits[128 / sizeof(long)];
} sigset_t;
#endif

#ifndef SA_NODEFER
#define SA_NOCLDSTOP 1
#define SA_NOCLDWAIT 2
#define SA_SIGINFO   4
#define SA_ONSTACK   0x08000000
#define SA_RESTART   0x10000000
#define SA_NODEFER   0x40000000
#define SA_RESETHAND 0x80000000
#endif

#ifndef SIG_BLOCK
#define SIG_BLOCK   0
#define SIG_UNBLOCK 1
#define SIG_SETMASK 2
#endif

#ifndef SS_ONSTACK
#define SS_ONSTACK 1
#define SS_DISABLE 2
#endif

struct __wasi_compat_siginfo;

struct sigaction {
  union {
    void (*sa_handler)(int);
    void (*sa_sigaction)(int, void *, void *);
  } __sa_handler;
  sigset_t sa_mask;
  int sa_flags;
  void (*sa_restorer)(void);
};
#define sa_handler   __sa_handler.sa_handler
#define sa_sigaction __sa_handler.sa_sigaction

typedef struct {
  void *ss_sp;
  int ss_flags;
  size_t ss_size;
} stack_t;

int sigaction(int, const struct sigaction *, struct sigaction *);
int sigaltstack(const stack_t *, stack_t *);
int sigprocmask(int, const sigset_t *, sigset_t *);
int sigemptyset(sigset_t *);
int sigfillset(sigset_t *);
int sigaddset(sigset_t *, int);
int sigdelset(sigset_t *, int);
int sigismember(const sigset_t *, int);

/* --- resource limits ------------------------------------------------------ */

#ifndef RLIMIT_CORE
#define RLIMIT_CPU   0
#define RLIMIT_FSIZE 1
#define RLIMIT_DATA  2
#define RLIMIT_STACK 3
#define RLIMIT_CORE  4
#endif

#ifndef RLIM_INFINITY
#define RLIM_INFINITY (~0ULL)
#endif

typedef unsigned long long rlim_t;

struct rlimit {
  rlim_t rlim_cur;
  rlim_t rlim_max;
};

int getrlimit(int, struct rlimit *);
int setrlimit(int, const struct rlimit *);

#ifdef __cplusplus
}
#endif

#endif /* __wasi__ */
#endif /* SIODITOR_WASI_COMPAT_H */
