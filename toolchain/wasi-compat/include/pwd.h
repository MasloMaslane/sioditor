/*
 * Minimal <pwd.h> for wasm32-wasip1.
 *
 * llvm/lib/Support/Unix/Path.inc includes it and calls getpwuid_r when looking for the
 * user's home directory. WASI has no user database, so the lookup always fails and LLVM
 * falls back to $HOME - which is the right answer in a browser anyway.
 */
#ifndef SIODITOR_PWD_H
#define SIODITOR_PWD_H

#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

struct passwd {
  char *pw_name;
  char *pw_passwd;
  uid_t pw_uid;
  gid_t pw_gid;
  char *pw_gecos;
  char *pw_dir;
  char *pw_shell;
};

struct passwd *getpwuid(uid_t);
int getpwuid_r(uid_t, struct passwd *, char *, size_t, struct passwd **);
struct passwd *getpwnam(const char *);
int getpwnam_r(const char *, struct passwd *, char *, size_t, struct passwd **);

#ifdef __cplusplus
}
#endif

#endif
