//! Lightweight sanity checks around the librqbit dependency (no live network).

#[test]
fn librqbit_version_is_nonempty() {
    let v = librqbit::version();
    assert!(!v.to_string().is_empty());
}
