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
#include <stddef.h>
#include <pwd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <dlfcn.h>
#include <sys/mman.h>

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

/* --- processes and users -------------------------------------------------- */

/*
 * Declared by the shim headers in wasi-compat/include, which exist only because LLVM's
 * Unix sources include <sys/wait.h> and <pwd.h> unconditionally. WASI has neither child
 * processes nor a user database, so both fail honestly.
 */

pid_t waitpid(pid_t pid, int *status, int options) {
  (void)pid;
  (void)status;
  (void)options;
  errno = ECHILD;
  return -1;
}

unsigned alarm(unsigned seconds) {
  (void)seconds;
  /* No timer, and nothing to deliver SIGALRM to. Report "no alarm was pending". */
  return 0;
}

int kill(pid_t pid, int sig) {
  (void)pid;
  (void)sig;
  errno = ESRCH;
  return -1;
}

pid_t wait(int *status) {
  (void)status;
  errno = ECHILD;
  return -1;
}

uid_t getuid(void) { return 0; }
uid_t geteuid(void) { return 0; }
gid_t getgid(void) { return 0; }
gid_t getegid(void) { return 0; }

mode_t umask(mode_t mask) {
  (void)mask;
  /* Report a conventional mask. Nothing consults the process umask under WASI. */
  return 0022;
}

/* Ownership is not a concept here; accepting the call keeps Path.inc on its happy path. */
int fchown(int fd, uid_t owner, gid_t group) {
  (void)fd;
  (void)owner;
  (void)group;
  return 0;
}

int chown(const char *path, uid_t owner, gid_t group) {
  (void)path;
  (void)owner;
  (void)group;
  return 0;
}

int lchown(const char *path, uid_t owner, gid_t group) {
  (void)path;
  (void)owner;
  (void)group;
  return 0;
}

/*
 * wasi-libc declares the dlfcn family but implements none of it, so LLVM's
 * DynamicLibrary.cpp compiles and then fails to link. A wasm module cannot load shared
 * objects at all; reporting failure is the truthful answer, and nothing in a compile
 * pipeline depends on plugin loading succeeding.
 */
/*
 * Declared by wasi-libc's <sys/mman.h> but not implemented. It is pure advice - the only
 * caller is LLVM's Path.cpp hinting at access patterns for a mapped file - so succeeding
 * without doing anything is exactly right.
 */
int posix_madvise(void *addr, size_t len, int advice) {
  (void)addr;
  (void)len;
  (void)advice;
  return 0;
}

void *dlopen(const char *file, int mode) {
  (void)file;
  (void)mode;
  return NULL;
}

int dlclose(void *handle) {
  (void)handle;
  return 0;
}

void *dlsym(void *handle, const char *name) {
  (void)handle;
  (void)name;
  return NULL;
}

char *dlerror(void) { return (char *)"dynamic loading is not available on WASI"; }

int dladdr(const void *addr, Dl_info *info) {
  (void)addr;
  (void)info;
  /* Zero means failure for dladdr, unlike most of POSIX. */
  return 0;
}

struct passwd *getpwnam(const char *name) {
  (void)name;
  errno = ENOENT;
  return NULL;
}

int getpwnam_r(const char *name, struct passwd *pwd, char *buf, size_t buflen,
               struct passwd **result) {
  (void)name;
  (void)pwd;
  (void)buf;
  (void)buflen;
  if (result)
    *result = NULL;
  return 0;
}

struct passwd *getpwuid(uid_t uid) {
  (void)uid;
  errno = ENOENT;
  return NULL;
}

int getpwuid_r(uid_t uid, struct passwd *pwd, char *buf, size_t buflen,
               struct passwd **result) {
  (void)uid;
  (void)pwd;
  (void)buf;
  (void)buflen;
  /* Reporting "no such user" rather than an error makes LLVM fall back to $HOME. */
  if (result)
    *result = NULL;
  return 0;
}

#endif /* __wasi__ */
