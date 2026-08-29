// Cross-checks the pb_ds shim against std::set / std::map over a randomised workload.
// Every ordered_set answer is compared with the same answer computed from a std::set, so
// a wrong tree fails loudly rather than merely looking plausible.
#include <bits/stdc++.h>
#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/tree_policy.hpp>
using namespace std;
using namespace __gnu_pbds;

typedef tree<int, null_type, less<int>, rb_tree_tag, tree_order_statistics_node_update>
    ordered_set;

int main() {
    ordered_set s;
    set<int> ref;

    mt19937 rng(12345);
    for (int step = 0; step < 20000; step++) {
        int op = rng() % 3;
        int key = (int)(rng() % 500);
        if (op == 0) {
            bool a = s.insert(key).second;
            bool b = ref.insert(key).second;
            if (a != b) { puts("insert disagrees"); return 1; }
        } else if (op == 1) {
            size_t a = s.erase(key);
            size_t b = ref.erase(key);
            if (a != b) { puts("erase disagrees"); return 1; }
        } else {
            if (s.size() != ref.size()) { puts("size disagrees"); return 1; }
            size_t rank = s.order_of_key(key);
            size_t expect = (size_t)distance(ref.begin(), ref.lower_bound(key));
            if (rank != expect) { puts("order_of_key disagrees"); return 1; }
            if (!ref.empty()) {
                size_t k = rng() % ref.size();
                auto it = s.find_by_order(k);
                auto rit = next(ref.begin(), (long)k);
                if (it == s.end() || *it != *rit) { puts("find_by_order disagrees"); return 1; }
            }
        }
    }

    // Iteration order and bounds.
    vector<int> mine(s.begin(), s.end());
    vector<int> theirs(ref.begin(), ref.end());
    if (mine != theirs) { puts("iteration disagrees"); return 1; }

    for (int key = -5; key < 505; key += 7) {
        auto a = s.lower_bound(key);
        auto b = ref.lower_bound(key);
        if ((a == s.end()) != (b == ref.end())) { puts("lower_bound end disagrees"); return 1; }
        if (a != s.end() && *a != *b) { puts("lower_bound disagrees"); return 1; }
        auto c = s.upper_bound(key);
        auto d = ref.upper_bound(key);
        if ((c == s.end()) != (d == ref.end())) { puts("upper_bound end disagrees"); return 1; }
        if (c != s.end() && *c != *d) { puts("upper_bound disagrees"); return 1; }
    }

    // find_by_order past the end is end(), the way the GNU original behaves.
    if (s.find_by_order(s.size()) != s.end()) { puts("past-the-end disagrees"); return 1; }

    // --end() must reach the last element.
    if (!ref.empty() && *prev(s.end()) != *prev(ref.end())) { puts("--end disagrees"); return 1; }

    // The map form.
    tree<int, string, less<int>, rb_tree_tag, tree_order_statistics_node_update> m;
    m[3] = "three";
    m[1] = "one";
    if (m.size() != 2 || m[1] != "one" || m[3] != "three") { puts("map form"); return 1; }
    if (m.find_by_order(0)->second != "one") { puts("map order"); return 1; }

    // gp_hash_table stands in for a fast unordered_map.
    gp_hash_table<int, int> h;
    h[7] = 49;
    if (h[7] != 49) { puts("gp_hash_table"); return 1; }

    printf("pbds ok, %zu elements\n", s.size());
    return 0;
}
