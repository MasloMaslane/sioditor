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
#include <sys/types.h>

/*
 * llvm/ADT/bit.h picks its endianness header from a list of known platforms, and __wasi__
 * is not on it, so it falls through to <machine/endian.h> - which wasi-libc does not have,
 * and the build dies compiling LLVMSupport's precompiled header.
 *
 * wasi-libc does provide <endian.h>, and it defines BYTE_ORDER properly. Including it here
 * means BYTE_ORDER is already set by the time bit.h runs its check, so the fallback never
 * fires. Cheaper and more durable than patching LLVM's platform list.
 */
#include <endian.h>

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

/*
 * wasi-libc seals siginfo_t behind __wasilibc_unmodified_upstream ("WASI has no siginfo").
 * Signals.inc needs the type for its SA_SIGINFO handler signatures, and sa_sigaction has
 * to match or the assignment is ill-formed - so this is defined before struct sigaction,
 * not alongside the functions.
 */
#ifndef __DEFINED_siginfo_t
#define __DEFINED_siginfo_t
typedef struct {
  int si_signo;
  int si_errno;
  int si_code;
  int si_pid;
  unsigned si_uid;
  int si_status;
  void *si_addr;
} siginfo_t;
#endif

#ifndef MINSIGSTKSZ
#define MINSIGSTKSZ 2048
#define SIGSTKSZ 8192
#endif

struct sigaction {
  union {
    void (*sa_handler)(int);
    void (*sa_sigaction)(int, siginfo_t *, void *);
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

/* --- processes, terminals, timers ------------------------------------------ */

/*
 * LLVM's Unix sources reach for these in Watchdog.inc, Program.inc and Process.inc. WASI
 * has no processes, no alarm timer and no controlling terminal, so the definitions in
 * wasi-compat.c all fail or no-op; they exist so the code compiles.
 */

unsigned alarm(unsigned);
int kill(pid_t, int);
pid_t wait(int *);

/* Process.inc asks the terminal for its width. There isn't one. */
#ifndef TIOCGWINSZ
#define TIOCGWINSZ 0x5413
struct winsize {
  unsigned short ws_row;
  unsigned short ws_col;
  unsigned short ws_xpixel;
  unsigned short ws_ypixel;
};
#endif

/* --- users, permissions, ownership ----------------------------------------- */

/*
 * A WASI module runs as nobody, owns nothing, and cannot change permissions it was not
 * granted. LLVM's Path.inc calls all of these while creating temporary files and
 * inspecting the environment. The definitions report a single fixed identity and accept
 * ownership changes without doing anything, which keeps Path.inc on its success path.
 */
uid_t getuid(void);
uid_t geteuid(void);
gid_t getgid(void);
gid_t getegid(void);
mode_t umask(mode_t);
int fchown(int, uid_t, gid_t);
int chown(const char *, uid_t, gid_t);
int lchown(const char *, uid_t, gid_t);

/* --- dynamic linking ------------------------------------------------------- */

/*
 * wasi-libc ships <dlfcn.h> but defines neither Dl_info nor dladdr, and LLVM's Path.inc
 * uses both under HAVE_DLOPEN to find the running executable. Nothing is dynamically
 * loaded in a wasm module, so dladdr always fails and LLVM falls back to argv[0].
 */
#ifndef SIODITOR_HAVE_DL_INFO
#define SIODITOR_HAVE_DL_INFO
typedef struct {
  const char *dli_fname;
  void *dli_fbase;
  const char *dli_sname;
  void *dli_saddr;
} Dl_info;

int dladdr(const void *, Dl_info *);
#endif

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
