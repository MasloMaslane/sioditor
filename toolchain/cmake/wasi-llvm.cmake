# CMake toolchain file for cross-compiling LLVM itself to wasm32-wasip1.
#
# Two lines here are load-bearing and non-obvious:
#
#   set(UNIX 1)
#     HandleLLVMOptions.cmake dispatches on WIN32 / UNIX / "Generic" and calls
#     message(SEND_ERROR "Unable to determine platform") when none match. WASI matches
#     none of them. Claiming UNIX also selects LLVM's Unix/*.inc sources, which are far
#     closer to wasi-libc than the no-platform path.
#
#   CMAKE_AR / CMAKE_RANLIB
#     GNU ar writes a symbol index it cannot generate for wasm objects; the failure
#     surfaces much later as "undefined symbol: vtable for llvm::cl::OptionValue<...>".
#     llvm-ar is required, not merely preferred.

set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
set(CMAKE_EXECUTABLE_SUFFIX .wasm)
set(UNIX 1)
set(CMAKE_CROSSCOMPILING TRUE)

if(NOT DEFINED WASI_SDK)
  message(FATAL_ERROR "WASI_SDK must point at an extracted wasi-sdk installation")
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
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
