// Order-statistic tree backing the __gnu_pbds shim.
//
// libstdc++'s ext/pb_ds is a GNU extension with no libc++ equivalent and no maintained
// port. This is a clean-room replacement covering what competitive programming actually
// uses: an ordered set or map that can also answer "what is the k-th element" and "how
// many elements are below this key".
//
// A treap rather than a red-black tree. The balance guarantee is expected rather than
// worst case, but priorities are drawn independently of the keys, so no input can force
// the bad case - and the implementation is a fraction of the size, which matters for
// something that has to be correct on first reading rather than merely plausible.
#pragma once

#include <cstddef>
#include <cstdint>
#include <iterator>

namespace __gnu_pbds {
namespace detail {

/// xorshift64*. Deterministic on purpose: a solution that misbehaves should misbehave the
/// same way twice. Priorities are independent of the keys either way.
inline std::uint64_t next_priority() {
  static std::uint64_t state = 0x9E3779B97F4A7C15ull;
  state ^= state >> 12;
  state ^= state << 25;
  state ^= state >> 27;
  return state * 0x2545F4914F6CDD1Dull;
}

template <class Value>
struct node {
  Value value;
  std::uint64_t priority;
  std::size_t size;
  node* left;
  node* right;
  node* parent;

  explicit node(const Value& v)
      : value(v), priority(next_priority()), size(1), left(nullptr), right(nullptr),
        parent(nullptr) {}
};

template <class Value>
inline std::size_t size_of(const node<Value>* n) {
  return n ? n->size : 0;
}

template <class Value>
inline void refresh(node<Value>* n) {
  if (!n) return;
  n->size = 1 + size_of(n->left) + size_of(n->right);
  if (n->left) n->left->parent = n;
  if (n->right) n->right->parent = n;
}

/// Splits `n` into everything ordered before `key` and everything at or after it.
template <class Value, class Key, class KeyOf, class Cmp>
void split(node<Value>* n, const Key& key, node<Value>*& lo, node<Value>*& hi,
           const KeyOf& key_of, const Cmp& cmp) {
  if (!n) {
    lo = hi = nullptr;
    return;
  }
  if (cmp(key_of(n->value), key)) {
    split(n->right, key, n->right, hi, key_of, cmp);
    lo = n;
  } else {
    split(n->left, key, lo, n->left, key_of, cmp);
    hi = n;
  }
  refresh(n);
  if (lo) lo->parent = nullptr;
  if (hi) hi->parent = nullptr;
}

/// Every key in `lo` must order before every key in `hi`.
template <class Value>
node<Value>* merge(node<Value>* lo, node<Value>* hi) {
  if (!lo) return hi;
  if (!hi) return lo;
  if (lo->priority > hi->priority) {
    lo->right = merge(lo->right, hi);
    refresh(lo);
    lo->parent = nullptr;
    return lo;
  }
  hi->left = merge(lo, hi->left);
  refresh(hi);
  hi->parent = nullptr;
  return hi;
}

template <class Value>
node<Value>* leftmost(node<Value>* n) {
  while (n && n->left) n = n->left;
  return n;
}

template <class Value>
node<Value>* rightmost(node<Value>* n) {
  while (n && n->right) n = n->right;
  return n;
}

template <class Value>
node<Value>* successor(node<Value>* n) {
  if (!n) return nullptr;
  if (n->right) return leftmost(n->right);
  while (n->parent && n->parent->right == n) n = n->parent;
  return n->parent;
}

template <class Value>
node<Value>* predecessor(node<Value>* n) {
  if (n->left) return rightmost(n->left);
  while (n->parent && n->parent->left == n) n = n->parent;
  return n->parent;
}

template <class Value>
void destroy(node<Value>* n) {
  if (!n) return;
  destroy(n->left);
  destroy(n->right);
  delete n;
}

template <class Value>
node<Value>* clone(const node<Value>* n, node<Value>* parent) {
  if (!n) return nullptr;
  node<Value>* copy = new node<Value>(n->value);
  copy->priority = n->priority;
  copy->size = n->size;
  copy->parent = parent;
  copy->left = clone(n->left, copy);
  copy->right = clone(n->right, copy);
  return copy;
}

/// Bidirectional iterator over the tree in key order.
///
/// end() carries a pointer to the owning root, so `--s.end()` can still reach the last
/// element - ordinary code relies on that.
template <class Value>
class tree_iterator {
 public:
  using iterator_category = std::bidirectional_iterator_tag;
  using value_type = Value;
  using difference_type = std::ptrdiff_t;
  using pointer = Value*;
  using reference = Value&;

  tree_iterator() : current_(nullptr), root_(nullptr) {}
  tree_iterator(node<Value>* current, node<Value>* const* root)
      : current_(current), root_(root) {}

  reference operator*() const { return current_->value; }
  pointer operator->() const { return &current_->value; }

  tree_iterator& operator++() {
    current_ = successor(current_);
    return *this;
  }
  tree_iterator operator++(int) {
    tree_iterator copy = *this;
    ++*this;
    return copy;
  }
  tree_iterator& operator--() {
    current_ = current_ ? predecessor(current_) : (root_ ? rightmost(*root_) : nullptr);
    return *this;
  }
  tree_iterator operator--(int) {
    tree_iterator copy = *this;
    --*this;
    return copy;
  }

  friend bool operator==(const tree_iterator& a, const tree_iterator& b) {
    return a.current_ == b.current_;
  }
  friend bool operator!=(const tree_iterator& a, const tree_iterator& b) {
    return a.current_ != b.current_;
  }

  node<Value>* raw() const { return current_; }

 private:
  node<Value>* current_;
  node<Value>* const* root_;
};

}  // namespace detail
}  // namespace __gnu_pbds
