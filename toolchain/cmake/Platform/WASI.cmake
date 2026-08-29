# Platform definition for CMAKE_SYSTEM_NAME=WASI.
#
# CMake only learned about WASI in 3.31; anything older prints "System is unknown to
# cmake, create: Platform/WASI to use this system" and, more importantly, never sets UNIX.
# LLVM's HandleLLVMOptions.cmake dispatches on WIN32 / UNIX / CYGWIN / "Generic" and calls
# message(SEND_ERROR "Unable to determine platform") when none matches, so without this
# file the configure fails there.
#
# Setting UNIX in the toolchain file is not enough: CMake resets platform variables while
# processing the (missing) platform module, so the value has to come from here.
#
# Claiming UNIX is also correct in substance - wasi-libc is a POSIX-ish libc, and LLVM's
# Unix/*.inc sources are far closer to it than the no-platform path.

set(UNIX 1)

set(CMAKE_DL_LIBS "")
set(CMAKE_STATIC_LIBRARY_PREFIX "lib")
set(CMAKE_STATIC_LIBRARY_SUFFIX ".a")
set(CMAKE_SHARED_LIBRARY_PREFIX "lib")
set(CMAKE_SHARED_LIBRARY_SUFFIX ".so")
set(CMAKE_EXECUTABLE_SUFFIX ".wasm")

# wasm32 links statically only.
set(CMAKE_FIND_LIBRARY_PREFIXES "lib")
set(CMAKE_FIND_LIBRARY_SUFFIXES ".a")

set(CMAKE_SHARED_LIBRARY_RUNTIME_C_FLAG "")
set(CMAKE_SHARED_LIBRARY_RPATH_LINK_C_FLAG "")

include(Platform/UnixPaths)
