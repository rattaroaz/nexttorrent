//! Structured diagnostic events for AI-efficient observability (JSONL schema v1).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagLevel {
    Info,
    Warn,
    Error,
    Fatal,
}

impl DiagLevel {
    pub fn is_error_like(self) -> bool {
        matches!(self, Self::Error | Self::Fatal)
    }
}

impl From<tracing::Level> for DiagLevel {
    fn from(level: tracing::Level) -> Self {
        match level {
            tracing::Level::ERROR => Self::Error,
            tracing::Level::WARN => Self::Warn,
            _ => Self::Info,
        }
    }
}

/// One machine-parseable diagnostic record (JSONL line / brief entry).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagEvent {
    pub v: u32,
    pub ts: String,
    pub level: DiagLevel,
    pub component: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corr: Option<String>,
    pub msg: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, String>,
    pub app_version: String,
}

impl DiagEvent {
    pub fn new(
        level: DiagLevel,
        component: impl Into<String>,
        event: impl Into<String>,
        msg: impl Into<String>,
    ) -> Self {
        Self {
            v: SCHEMA_VERSION,
            ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level,
            component: component.into(),
            event: event.into(),
            corr: None,
            msg: msg.into(),
            fields: BTreeMap::new(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    pub fn with_corr(mut self, corr: impl Into<String>) -> Self {
        self.corr = Some(corr.into());
        self
    }

    pub fn with_field(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.fields.insert(key.into(), value.into());
        self
    }

    pub fn with_fields(mut self, fields: BTreeMap<String, String>) -> Self {
        self.fields.extend(fields);
        self
    }

    /// Human-readable line for the Activity UI / nexttorrent.log.
    pub fn to_human_line(&self) -> String {
        let level = match self.level {
            DiagLevel::Info => "INFO",
            DiagLevel::Warn => "WARN",
            DiagLevel::Error => "ERROR",
            DiagLevel::Fatal => "FATAL",
        };
        let mut line = format!("{level} {} — {}", self.component, self.msg);
        if let Some(corr) = &self.corr {
            line.push_str(&format!(" corr={corr}"));
        }
        if !self.fields.is_empty() {
            let joined = self
                .fields
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(", ");
            line.push_str(&format!(" ({joined})"));
        }
        // Local stamp for UI consistency with existing logs.
        let local = chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S%.3f")
            .to_string();
        format!("{local} {line}")
    }

    pub fn to_json_line(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// Short hex correlation id for tying IPC → Rust work.
pub fn new_corr() -> String {
    static N: AtomicU64 = AtomicU64::new(1);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let mixed = (std::process::id() as u64)
        .wrapping_mul(0x9E37_79B9)
        .wrapping_add(n)
        .wrapping_mul(0x85EB_CA6B);
    format!("{:08x}", mixed & 0xFFFF_FFFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_roundtrip() {
        let ev = DiagEvent::new(
            DiagLevel::Error,
            "updater_http",
            "feed_fetch_failed",
            "boom",
        )
        .with_corr("abcd1234")
        .with_field("url", "https://example.com");
        let line = ev.to_json_line().unwrap();
        let back: DiagEvent = serde_json::from_str(&line).unwrap();
        assert_eq!(back.v, SCHEMA_VERSION);
        assert_eq!(back.event, "feed_fetch_failed");
        assert_eq!(back.corr.as_deref(), Some("abcd1234"));
        assert_eq!(
            back.fields.get("url").map(String::as_str),
            Some("https://example.com")
        );
    }

    #[test]
    fn corr_is_hex8() {
        let c = new_corr();
        assert_eq!(c.len(), 8);
        assert!(c.chars().all(|ch| ch.is_ascii_hexdigit()));
    }
}
