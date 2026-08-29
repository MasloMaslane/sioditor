// <bits/stdc++.h> for libc++.
//
// The GNU original is nothing more than an aggregate header, so this is a faithful
// substitute rather than an approximation. Every entry is guarded with __has_include so a
// libc++ version that lacks one degrades instead of breaking the build - and so headers
// removed in C++17/20/23 (<ciso646>, <cstdbool>, <cstdalign>) can simply be absent.
//
// Byte stability matters here: a precompiled header is keyed to this file's contents, so
// changing it invalidates that PCH.

#pragma once

// C library
#include <cassert>
#include <cctype>
#include <cerrno>
#include <cfloat>
#include <climits>
#include <clocale>
#include <cmath>

// <csetjmp> is a hard #error on wasm32-wasip1 unless the module is built with wasm
// exception handling, and setjmp has no place in a competitive-programming solution
// anyway. <csignal> needs -D_WASI_EMULATED_SIGNAL, which the compile flags pass.
#if defined(__wasm_exception_handling__) || !defined(__wasi__)
#include <csetjmp>
#endif
#include <csignal>
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <cwchar>
#include <cwctype>

#if __has_include(<cfenv>)
#include <cfenv>
#endif
#if __has_include(<cinttypes>)
#include <cinttypes>
#endif
#if __has_include(<cstdint>)
#include <cstdint>
#endif
#if __has_include(<cuchar>)
#include <cuchar>
#endif

// Containers
#include <array>
#include <bitset>
#include <deque>
#include <list>
#include <map>
#include <queue>
#include <set>
#include <stack>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// Core language support and utilities
#include <algorithm>
#include <complex>
#include <exception>
#include <functional>
#include <iterator>
#include <limits>
#include <locale>
#include <memory>
#include <new>
#include <numeric>
#include <stdexcept>
#include <string>
#include <tuple>
#include <typeinfo>
#include <type_traits>
#include <utility>
#include <valarray>

// I/O
#include <fstream>
#include <iomanip>
#include <ios>
#include <iosfwd>
#include <iostream>
#include <istream>
#include <ostream>
#include <sstream>
#include <streambuf>

// Concurrency. Present in libc++ but inert on wasm32-wasip1, which has no threads;
// included so code that mentions them still compiles.
#if __has_include(<atomic>)
#include <atomic>
#endif
#if __has_include(<chrono>)
#include <chrono>
#endif
#if __has_include(<condition_variable>)
#include <condition_variable>
#endif
#if __has_include(<mutex>)
#include <mutex>
#endif
#if __has_include(<thread>)
#include <thread>
#endif
#if __has_include(<future>)
#include <future>
#endif

// C++11 onwards
#if __has_include(<initializer_list>)
#include <initializer_list>
#endif
#if __has_include(<random>)
#include <random>
#endif
#if __has_include(<ratio>)
#include <ratio>
#endif
#if __has_include(<regex>)
#include <regex>
#endif
#if __has_include(<scoped_allocator>)
#include <scoped_allocator>
#endif
#if __has_include(<system_error>)
#include <system_error>
#endif
#if __has_include(<typeindex>)
#include <typeindex>
#endif
#if __has_include(<forward_list>)
#include <forward_list>
#endif

// C++17
#if __has_include(<any>)
#include <any>
#endif
#if __has_include(<charconv>)
#include <charconv>
#endif
#if __has_include(<filesystem>)
#include <filesystem>
#endif
#if __has_include(<memory_resource>)
#include <memory_resource>
#endif
#if __has_include(<optional>)
#include <optional>
#endif
#if __has_include(<string_view>)
#include <string_view>
#endif
#if __has_include(<variant>)
#include <variant>
#endif

// C++20
#if __has_include(<version>)
#include <version>
#endif
#if __has_include(<bit>)
#include <bit>
#endif
#if __has_include(<compare>)
#include <compare>
#endif
#if __has_include(<concepts>)
#include <concepts>
#endif
#if __has_include(<numbers>)
#include <numbers>
#endif
#if __has_include(<ranges>)
#include <ranges>
#endif
#if __has_include(<span>)
#include <span>
#endif

// C++23
#if __has_include(<expected>)
#include <expected>
#endif
#if __has_include(<flat_map>)
#include <flat_map>
#endif
#if __has_include(<flat_set>)
#include <flat_set>
#endif
#if __has_include(<generator>)
#include <generator>
#endif
#if __has_include(<mdspan>)
#include <mdspan>
#endif
#if __has_include(<print>)
#include <print>
#endif
#if __has_include(<stacktrace>)
#include <stacktrace>
#endif
#if __has_include(<stdfloat>)
#include <stdfloat>
#endif

// Deliberately absent, and not merely forgotten:
//   <execution>  - libc++ has no parallel algorithms on a target without threads
//   <ext/...>    - GNU extensions; see the pb_ds shim alongside this file
