// Node-update policies for __gnu_pbds::tree.
//
// Only the order-statistics policy does anything here. It is a tag: the tree always
// maintains subtree sizes, because that is the only reason this shim exists.
#pragma once

namespace __gnu_pbds {

/// Selects find_by_order and order_of_key.
struct tree_order_statistics_node_update {};

/// The default: no extra operations.
struct null_node_update {};

}  // namespace __gnu_pbds
