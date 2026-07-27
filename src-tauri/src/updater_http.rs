//! Update feed fetch/install via the app's reqwest client.
//!
//! `tauri-plugin-updater`'s own HTTP stack fails on some Windows setups with
//! "error sending request" for the GitHub Releases URL, while this client's
//! requests succeed. Signature verification still uses the same minisign pubkey
//! as `tauri.conf.json`.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

/// Must match `plugins.updater.endpoints[0]` in tauri.conf.json.
const UPDATE_ENDPOINT: &str =
    "https://github.com/rattaroaz/nexttorrent/releases/latest/download/latest.json";

/// Must match `plugins.updater.pubkey` in tauri.conf.json.
const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFGNzNERDJBRDIyMTk4MDMKUldRRG1DSFNLdDF6cjhReDBQSUZ5d3hueCtIMXpGNk9DN3ZCSkZSTXd0T0V1YSt1eCsxdXBrR3QK";

#[derive(Debug, Deserialize)]
struct RemoteRelease {
    version: String,
    notes: Option<String>,
    platforms: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
struct PlatformArtifact {
    url: String,
    signature: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterCheckResult {
    pub status: String,
    pub installed_version: String,
    pub remote_version: Option<String>,
    pub notes: Option<String>,
    pub download_url: Option<String>,
    pub signature: Option<String>,
}

fn installed_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn is_version_newer(candidate: &str, installed: &str) -> bool {
    fn parse(v: &str) -> Option<(u64, u64, u64)> {
        let s = v.trim().trim_start_matches(['v', 'V']);
        let s = s.split('+').next().unwrap_or(s);
        let s = s.split('-').next().unwrap_or(s);
        let mut parts = s.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts.next().map(|p| p.parse().ok()).unwrap_or(Some(0))?;
        if parts.next().is_some() {
            return None;
        }
        Some((major, minor, patch))
    }
    match (parse(candidate), parse(installed)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

fn pick_windows_artifact(
    platforms: &serde_json::Map<String, serde_json::Value>,
) -> Option<PlatformArtifact> {
    for key in [
        "windows-x86_64-nsis",
        "windows-x86_64",
        "windows-x86_64-msi",
    ] {
        if let Some(value) = platforms.get(key) {
            let url = value.get("url")?.as_str()?.to_string();
            let signature = value.get("signature")?.as_str()?.to_string();
            if !url.is_empty() && !signature.is_empty() {
                return Some(PlatformArtifact { url, signature });
            }
        }
    }
    None
}

fn format_reqwest_error(err: &reqwest::Error) -> String {
    let mut msg = format!("{err:#}");
    let mut source = std::error::Error::source(err);
    while let Some(s) = source {
        msg.push_str(&format!("\ncaused by: {s:#}"));
        source = s.source();
    }
    msg
}

fn fail_updater(event: &str, message: String, fields: Vec<(String, String)>) -> String {
    let corr = crate::diag_log::emit_failure("updater_http", event, &message, fields);
    format!("{message} corr={corr}")
}

async fn fetch_release(client: &reqwest::Client) -> Result<RemoteRelease, String> {
    let response = client
        .get(UPDATE_ENDPOINT)
        .timeout(Duration::from_secs(60))
        .header(
            "User-Agent",
            concat!("nexttorrent/", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .map_err(|e| {
            fail_updater(
                "feed_fetch_failed",
                format!("failed to fetch update feed: {}", format_reqwest_error(&e)),
                vec![("url".into(), UPDATE_ENDPOINT.into())],
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(fail_updater(
            "feed_fetch_failed",
            format!("update feed returned HTTP {status} for {UPDATE_ENDPOINT}"),
            vec![
                ("url".into(), UPDATE_ENDPOINT.into()),
                ("status".into(), status.as_u16().to_string()),
            ],
        ));
    }

    response.json::<RemoteRelease>().await.map_err(|e| {
        fail_updater(
            "feed_fetch_failed",
            format!("invalid update feed JSON: {}", format_reqwest_error(&e)),
            vec![("url".into(), UPDATE_ENDPOINT.into())],
        )
    })
}

fn verify_signature(data: &[u8], release_signature: &str, pub_key: &str) -> Result<(), String> {
    let pub_key_decoded = base64::engine::general_purpose::STANDARD
        .decode(pub_key)
        .map_err(|e| format!("invalid updater pubkey base64: {e}"))?;
    let pub_key_str = std::str::from_utf8(&pub_key_decoded)
        .map_err(|_| "updater pubkey is not valid UTF-8".to_string())?;
    let public_key =
        PublicKey::decode(pub_key_str).map_err(|e| format!("invalid updater pubkey: {e}"))?;

    let sig_decoded = base64::engine::general_purpose::STANDARD
        .decode(release_signature)
        .map_err(|e| format!("invalid release signature base64: {e}"))?;
    let sig_str = std::str::from_utf8(&sig_decoded)
        .map_err(|_| "release signature is not valid UTF-8".to_string())?;
    let signature =
        Signature::decode(sig_str).map_err(|e| format!("invalid release signature: {e}"))?;

    public_key.verify(data, &signature, true).map_err(|e| {
        fail_updater(
            "signature_failed",
            format!("updater signature verification failed: {e}"),
            vec![],
        )
    })
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn updater_check_feed(state: State<'_, AppState>) -> Result<UpdaterCheckResult, String> {
    let installed = installed_version();
    let release = fetch_release(&state.http_client).await?;
    tracing::info!(
        installed = %installed,
        remote = %release.version,
        "fetched update feed"
    );

    if !is_version_newer(&release.version, &installed) {
        return Ok(UpdaterCheckResult {
            status: "up_to_date".into(),
            installed_version: installed,
            remote_version: Some(release.version),
            notes: release.notes,
            download_url: None,
            signature: None,
        });
    }

    let artifact = pick_windows_artifact(&release.platforms).ok_or_else(|| {
        fail_updater(
            "feed_fetch_failed",
            "update feed has no Windows installer artifact (windows-x86_64-nsis / msi)".to_string(),
            vec![("remoteVersion".into(), release.version.clone())],
        )
    })?;

    Ok(UpdaterCheckResult {
        status: "available".into(),
        installed_version: installed,
        remote_version: Some(release.version),
        notes: release.notes,
        download_url: Some(artifact.url),
        signature: Some(artifact.signature),
    })
}

#[tauri::command]
#[tracing::instrument(skip(state, signature))]
pub async fn updater_download_and_install(
    state: State<'_, AppState>,
    download_url: String,
    signature: String,
    version: String,
) -> Result<(), String> {
    if download_url.is_empty() || signature.is_empty() {
        return Err("missing download URL or signature".into());
    }

    tracing::info!(%version, %download_url, "downloading update package");
    let bytes = state
        .http_client
        .get(&download_url)
        .timeout(Duration::from_secs(600))
        .header(
            "User-Agent",
            concat!("nexttorrent/", env!("CARGO_PKG_VERSION")),
        )
        .send()
        .await
        .map_err(|e| {
            fail_updater(
                "download_failed",
                format!("failed to download update: {}", format_reqwest_error(&e)),
                vec![
                    ("url".into(), download_url.clone()),
                    ("version".into(), version.clone()),
                ],
            )
        })?
        .error_for_status()
        .map_err(|e| {
            fail_updater(
                "download_failed",
                format!("update download HTTP error: {}", format_reqwest_error(&e)),
                vec![("url".into(), download_url.clone())],
            )
        })?
        .bytes()
        .await
        .map_err(|e| {
            fail_updater(
                "download_failed",
                format!("failed to read update bytes: {}", format_reqwest_error(&e)),
                vec![("url".into(), download_url.clone())],
            )
        })?;

    verify_signature(&bytes, &signature, UPDATER_PUBKEY)?;
    tracing::info!(bytes = bytes.len(), "update signature verified");

    let temp_dir = std::env::temp_dir().join(format!(
        "nexttorrent-{}-updater-{}",
        version,
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let installer_path = if download_url.to_ascii_lowercase().ends_with(".msi") {
        temp_dir.join(format!("Nexttorrent_{version}_x64_en-US.msi"))
    } else {
        temp_dir.join(format!("Nexttorrent_{version}_x64-setup.exe"))
    };
    std::fs::write(&installer_path, &bytes).map_err(|e| e.to_string())?;

    launch_windows_installer(&installer_path).map_err(|e| {
        fail_updater(
            "installer_launch_failed",
            e,
            vec![("version".into(), version.clone())],
        )
    })?;
    // NSIS/MSI take over; match tauri-plugin-updater and exit this process.
    std::process::exit(0);
}

fn launch_windows_installer(path: &Path) -> Result<(), String> {
    let path_str = path.to_string_lossy();
    let mut cmd = if path_str.to_ascii_lowercase().ends_with(".msi") {
        let mut c = Command::new("msiexec.exe");
        c.arg("/i").arg(path).args(["/passive", "/promptrestart"]);
        c
    } else {
        // /P passive, /R relaunch, /UPDATER marks an in-app update install.
        let mut c = Command::new(path);
        c.args(["/P", "/R", "/UPDATER"]);
        c
    };

    cmd.spawn()
        .map_err(|e| format!("failed to launch installer {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_newer_strict() {
        assert!(is_version_newer("1.1.1", "1.1.0"));
        assert!(!is_version_newer("1.1.0", "1.1.0"));
        assert!(!is_version_newer("1.0.0", "1.1.0"));
        assert!(is_version_newer("v1.2.0", "1.1.9"));
    }

    #[test]
    fn picks_nsis_before_msi() {
        let mut platforms = serde_json::Map::new();
        platforms.insert(
            "windows-x86_64-msi".into(),
            serde_json::json!({"url":"http://msi","signature":"sig-msi"}),
        );
        platforms.insert(
            "windows-x86_64-nsis".into(),
            serde_json::json!({"url":"http://nsis","signature":"sig-nsis"}),
        );
        let art = pick_windows_artifact(&platforms).unwrap();
        assert_eq!(art.url, "http://nsis");
        assert_eq!(art.signature, "sig-nsis");
    }
}
