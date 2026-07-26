//! Network interface listing for VPN / bind UI.

use serde::Serialize;
use sysinfo::Networks;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub received_bytes: u64,
    pub transmitted_bytes: u64,
}

pub fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    let networks = Networks::new_with_refreshed_list();
    let mut out: Vec<NetworkInterfaceInfo> = networks
        .iter()
        .map(|(name, data)| NetworkInterfaceInfo {
            name: name.clone(),
            received_bytes: data.received(),
            transmitted_bytes: data.transmitted(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
