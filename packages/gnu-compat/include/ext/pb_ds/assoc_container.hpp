// __gnu_pbds::tree and the hash tables, for libc++.
//
// A clean-room stand-in for the parts of libstdc++'s ext/pb_ds that competitive
// programming uses. Not a port: the GNU original is 1.1 MB of policy-based templates
// resting on libstdc++ internals that libc++ does not have.
//
// What is covered:
//   tree<Key, null_type, Cmp, rb_tree_tag, tree_order_statistics_node_update>
//   tree<Key, Mapped, ...>            the map form, with operator[]
//   find_by_order, order_of_key
//   gp_hash_table, cc_hash_table      aliases over std::unordered_map
//
// What is not: split and join on trees, the trie and priority-queue containers, and the
// other tag types. Those fail to compile with a message naming what is missing, rather
// than silently behaving differently - see the static_assert below.
#pragma once

#include <cstddef>
#include <functional>
#include <unordered_map>
#include <unordered_set>
#include <type_traits>
#include <utility>

#include "detail/ost.hpp"
#include "tree_policy.hpp"

namespace __gnu_pbds {

/// Marks the set form of `tree`, where there is no mapped value.
struct null_type {};

/// Container tags. Only rb_tree_tag is implemented; the others exist so that code naming
/// them fails with a clear message instead of an unknown-identifier error.
struct rb_tree_tag {};
struct splay_tree_tag {};
struct ov_tree_tag {};

namespace detail {

template <class Key, class Mapped>
struct value_of {
  using type = std::pair<const Key, Mapped>;
  static const Key& key(const type& v) { return v.first; }
};

template <class Key>
struct value_of<Key, null_type> {
  using type = Key;
  static const Key& key(const type& v) { return v; }
};

}  // namespace detail

/**
 * An ordered set or map that also answers order-statistic queries.
 *
 * Iterators are invalidated by insert and erase, unlike the GNU original, because the
 * treap re-links nodes on every update. Code that holds an iterator across a modification
 * is rare in this setting and is a bug against the real container's guarantees anyway.
 */
template <class Key, class Mapped, class Cmp = std::less<Key>, class Tag = rb_tree_tag,
          class NodeUpdate = null_node_update>
class tree {
  static_assert(std::is_same<Tag, rb_tree_tag>::value,
                "sioditor's pb_ds shim implements rb_tree_tag only; splay_tree_tag and "
                "ov_tree_tag are not available");

  using traits = detail::value_of<Key, Mapped>;

 public:
  using key_type = Key;
  using mapped_type = Mapped;
  using value_type = typename traits::type;
  using size_type = std::size_t;
  using iterator = detail::tree_iterator<value_type>;
  using const_iterator = iterator;

  tree() = default;
  explicit tree(const Cmp& cmp) : cmp_(cmp) {}

  tree(const tree& other) : cmp_(other.cmp_) { root_ = detail::clone(other.root_, nullptr); }

  tree& operator=(const tree& other) {
    if (this == &other) return *this;
    detail::destroy(root_);
    cmp_ = other.cmp_;
    root_ = detail::clone(other.root_, nullptr);
    return *this;
  }

  tree(tree&& other) noexcept : root_(other.root_), cmp_(other.cmp_) { other.root_ = nullptr; }

  tree& operator=(tree&& other) noexcept {
    if (this == &other) return *this;
    detail::destroy(root_);
    root_ = other.root_;
    cmp_ = other.cmp_;
    other.root_ = nullptr;
    return *this;
  }

  ~tree() { detail::destroy(root_); }

  size_type size() const { return detail::size_of(root_); }
  bool empty() const { return root_ == nullptr; }

  void clear() {
    detail::destroy(root_);
    root_ = nullptr;
  }

  iterator begin() const { return iterator(detail::leftmost(root_), &root_); }
  iterator end() const { return iterator(nullptr, &root_); }

  iterator find(const Key& key) const {
    detail::node<value_type>* n = root_;
    while (n) {
      if (cmp_(key, traits::key(n->value))) n = n->left;
      else if (cmp_(traits::key(n->value), key)) n = n->right;
      else return iterator(n, &root_);
    }
    return end();
  }

  iterator lower_bound(const Key& key) const { return bound(key, false); }
  iterator upper_bound(const Key& key) const { return bound(key, true); }

  std::pair<iterator, bool> insert(const value_type& value) {
    const Key& key = traits::key(value);
    iterator existing = find(key);
    if (existing != end()) return {existing, false};

    detail::node<value_type>* lo = nullptr;
    detail::node<value_type>* hi = nullptr;
    detail::split(root_, key, lo, hi, key_of, cmp_);
    detail::node<value_type>* fresh = new detail::node<value_type>(value);
    root_ = detail::merge(detail::merge(lo, fresh), hi);
    if (root_) root_->parent = nullptr;
    return {iterator(fresh, &root_), true};
  }

  size_type erase(const Key& key) {
    detail::node<value_type>* lo = nullptr;
    detail::node<value_type>* rest = nullptr;
    detail::split(root_, key, lo, rest, key_of, cmp_);

    // `rest` begins at the first node not ordered before `key`. That node holds `key`
    // exactly when `key` is not ordered before it in turn.
    detail::node<value_type>* first = detail::leftmost(rest);
    const bool present = first && !cmp_(key, traits::key(first->value));
    if (present) rest = erase_leftmost(rest);

    root_ = detail::merge(lo, rest);
    if (root_) root_->parent = nullptr;
    return present ? 1 : 0;
  }

  /// The k-th element in key order, or end() when k is past the last.
  iterator find_by_order(size_type k) const {
    static_assert(std::is_same<NodeUpdate, tree_order_statistics_node_update>::value,
                  "find_by_order requires tree_order_statistics_node_update");
    detail::node<value_type>* n = root_;
    while (n) {
      const size_type left = detail::size_of(n->left);
      if (k < left) {
        n = n->left;
      } else if (k == left) {
        return iterator(n, &root_);
      } else {
        k -= left + 1;
        n = n->right;
      }
    }
    return end();
  }

  /// Map form only: inserts a default-constructed value when the key is absent.
  template <class M = Mapped>
  typename std::enable_if<!std::is_same<M, null_type>::value, M&>::type
  operator[](const Key& key) {
    iterator found = find(key);
    if (found == end()) found = insert(value_type(key, M())).first;
    return found->second;
  }

  /// How many elements order strictly before `key`.
  size_type order_of_key(const Key& key) const {
    static_assert(std::is_same<NodeUpdate, tree_order_statistics_node_update>::value,
                  "order_of_key requires tree_order_statistics_node_update");
    size_type rank = 0;
    detail::node<value_type>* n = root_;
    while (n) {
      if (cmp_(traits::key(n->value), key)) {
        rank += detail::size_of(n->left) + 1;
        n = n->right;
      } else {
        n = n->left;
      }
    }
    return rank;
  }

 private:
  struct key_of_t {
    const Key& operator()(const value_type& v) const { return traits::key(v); }
  };

  iterator bound(const Key& key, bool strict) const {
    detail::node<value_type>* n = root_;
    detail::node<value_type>* best = nullptr;
    while (n) {
      const bool before = strict ? !cmp_(key, traits::key(n->value))
                                 : cmp_(traits::key(n->value), key);
      if (before) {
        n = n->right;
      } else {
        best = n;
        n = n->left;
      }
    }
    return iterator(best, &root_);
  }

  /// Removes and frees the leftmost node, returning what remains.
  ///
  /// The leftmost node has no left child by definition, so it is replaced by its right
  /// subtree and sizes are refreshed on the way back up the recursion - no parent
  /// walking, which is where the first attempt at this went wrong.
  static detail::node<value_type>* erase_leftmost(detail::node<value_type>* n) {
    if (!n) return nullptr;
    if (!n->left) {
      detail::node<value_type>* right = n->right;
      delete n;
      if (right) right->parent = nullptr;
      return right;
    }
    n->left = erase_leftmost(n->left);
    detail::refresh(n);
    n->parent = nullptr;
    return n;
  }

  detail::node<value_type>* root_ = nullptr;
  Cmp cmp_{};
  key_of_t key_of{};
};

/// The hash containers are used purely as faster unordered_map/set in this setting, so
/// aliases are the honest implementation.
template <class Key, class Mapped, class Hash = std::hash<Key>>
using gp_hash_table = std::unordered_map<Key, Mapped, Hash>;

template <class Key, class Mapped, class Hash = std::hash<Key>>
using cc_hash_table = std::unordered_map<Key, Mapped, Hash>;

}  // namespace __gnu_pbds
