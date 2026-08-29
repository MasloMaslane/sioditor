/*
 * Minimal <sys/wait.h> for wasm32-wasip1, which has no such header.
 *
 * WASI has no child processes, so nothing here can ever do anything useful. It exists
 * because llvm/lib/Support/Unix/Unix.h includes <sys/wait.h> unconditionally, and that
 * header is pulled in by every Unix/*.inc consumer - so its absence stops the build long
 * before any process-related code would run.
 *
 * The status macros are musl's, so anything that does inspect a status behaves sanely.
 */
#ifndef SIODITOR_SYS_WAIT_H
#define SIODITOR_SYS_WAIT_H

#include <sys/resource.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WNOHANG   1
#define WUNTRACED 2
#define WSTOPPED  2
#define WEXITED   4
#define WCONTINUED 8
#define WNOWAIT   0x01000000

#define WEXITSTATUS(s) (((s) & 0xff00) >> 8)
#define WTERMSIG(s)    ((s) & 0x7f)
#define WSTOPSIG(s)    WEXITSTATUS(s)
#define WIFEXITED(s)   (!WTERMSIG(s))
#define WIFSTOPPED(s)  ((short)((((s) & 0xffff) * 0x10001U) >> 8) > 0x7f00)
#define WIFSIGNALED(s) (((s) & 0xffff) - 1U < 0xffu)
#define WCOREDUMP(s)   ((s) & 0x80)
#define WIFCONTINUED(s) ((s) == 0xffff)

pid_t waitpid(pid_t, int *, int);

#ifdef __cplusplus
}
#endif

#endif
