//! Smoke check that packaging metadata expected by CI/release is present.

#[test]
fn tauri_config_declares_app_identifier() {
    let raw = include_str!("../tauri.conf.json");
    assert!(
        raw.contains("\"identifier\""),
        "tauri.conf.json should declare bundle identifier"
    );
    assert!(
        raw.contains("com.nexttorrent.desktop"),
        "expected known bundle identifier substring"
    );
}
