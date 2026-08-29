# CMake toolchain file for cross-compiling LLVM itself to wasm32-wasip1.
#
# Two lines here are load-bearing and non-obvious:
#
#   Platform/WASI.cmake
#     CMake before 3.31 has no WASI platform module and so never sets UNIX, which makes
#     LLVM's HandleLLVMOptions.cmake abort with "Unable to determine platform". We ship
#     one next to this file; see it for why UNIX is the right claim.
#
#   CMAKE_AR / CMAKE_RANLIB
#     GNU ar writes a symbol index it cannot generate for wasm objects; the failure
#     surfaces much later as "undefined symbol: vtable for llvm::cl::OptionValue<...>".
#     llvm-ar is required, not merely preferred.

# Must precede CMAKE_SYSTEM_NAME so CMake finds our Platform/WASI.cmake when it goes
# looking for the platform module. CMake only ships one from 3.31 onwards.
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}")

set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(CMAKE_EXECUTABLE_SUFFIX .wasm)
set(CMAKE_CROSSCOMPILING TRUE)

# CMake re-includes this file inside the try_compile sub-project it uses to probe the
# compiler, and cache variables passed with -D do not propagate into that nested scope.
# Without the two lines below, WASI_SDK is set for the real build and empty inside the
# probe, which fails with a confusing "CMAKE_C_COMPILER not set, after EnableLanguage".
if(NOT DEFINED WASI_SDK AND DEFINED ENV{WASI_SDK})
  set(WASI_SDK "$ENV{WASI_SDK}")
endif()
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES WASI_SDK)

if(NOT DEFINED WASI_SDK)
  message(FATAL_ERROR "WASI_SDK must point at an extracted wasi-sdk installation")
endif()

if(NOT EXISTS "${WASI_SDK}/bin/clang")
  message(FATAL_ERROR "no clang at ${WASI_SDK}/bin/clang - is WASI_SDK correct?")
endif()

set(_triple wasm32-wasip1)

set(CMAKE_C_COMPILER   "${WASI_SDK}/bin/clang")
set(CMAKE_CXX_COMPILER "${WASI_SDK}/bin/clang++")
set(CMAKE_AR           "${WASI_SDK}/bin/llvm-ar")
set(CMAKE_RANLIB       "${WASI_SDK}/bin/llvm-ranlib")
set(CMAKE_C_COMPILER_TARGET   ${_triple})
set(CMAKE_CXX_COMPILER_TARGET ${_triple})
set(CMAKE_SYSROOT "${WASI_SDK}/share/wasi-sysroot")

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)

# Nothing built during configure can be executed, so probe with static libraries.
#
# The catch: this makes every link-based check compile-only, so checks that should fail at
# link now pass. CMake's FindThreads is the one that bites - it "finds" -lpthreads and the
# real link then fails with "unable to find library -lpthreads". wasm32-wasip1 has no
# threads at all (its libpthread.a is an empty 8-byte archive), so the answer is settled
# here rather than probed.
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# LLVM's config-ix.cmake gates its whole pthread search on HAVE_LIBPTHREAD, and reaches
# for libdl and librt the same way. All three are check_library_exists probes, so all
# three pass spuriously here. Pre-seeding the cache variables skips the probes entirely
# rather than letting them run and answer wrongly.
set(HAVE_LIBPTHREAD 0 CACHE INTERNAL "" FORCE)
set(HAVE_LIBDL 0 CACHE INTERNAL "" FORCE)
set(HAVE_LIBRT 0 CACHE INTERNAL "" FORCE)
set(HAVE_PTHREAD_MUTEX_LOCK 0 CACHE INTERNAL "" FORCE)
set(HAVE_PTHREAD_RWLOCK_INIT 0 CACHE INTERNAL "" FORCE)
set(HAVE_PTHREAD_GETNAME_NP 0 CACHE INTERNAL "" FORCE)
set(HAVE_PTHREAD_SETNAME_NP 0 CACHE INTERNAL "" FORCE)
set(CMAKE_HAVE_PTHREADS_CREATE 0 CACHE INTERNAL "" FORCE)
set(CMAKE_HAVE_PTHREAD_CREATE 0 CACHE INTERNAL "" FORCE)

set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY 0 CACHE INTERNAL "" FORCE)
set(CMAKE_USE_PTHREADS_INIT 0 CACHE INTERNAL "" FORCE)
set(CMAKE_USE_WIN32_THREADS_INIT 0 CACHE INTERNAL "" FORCE)
set(THREADS_PREFER_PTHREAD_FLAG OFF)
set(LLVM_PTHREAD_LIB "" CACHE STRING "" FORCE)
