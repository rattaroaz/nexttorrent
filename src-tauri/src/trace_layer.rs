//! Tracing layer that mirrors INFO+ events into structured diagnostics + Activity UI.

use std::collections::BTreeMap;

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

use crate::diag_event::{DiagEvent, DiagLevel};
use crate::diag_log;

struct EventVisitor {
    message: String,
    fields: BTreeMap<String, String>,
}

impl EventVisitor {
    fn new() -> Self {
        Self {
            message: String::new(),
            fields: BTreeMap::new(),
        }
    }
}

impl Visit for EventVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let name = field.name();
        let rendered = format!("{value:?}").trim_matches('"').to_string();
        if name == "message" {
            self.message = rendered;
        } else if !rendered.is_empty() {
            self.fields.insert(name.to_string(), rendered);
        }
    }
}

fn event_code_from_message(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    let slug: String = lower
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let trimmed = slug.trim_matches('_');
    let mut out = String::new();
    let mut prev_us = false;
    for c in trimmed.chars().take(48) {
        if c == '_' {
            if !prev_us && !out.is_empty() {
                out.push('_');
                prev_us = true;
            }
        } else {
            out.push(c);
            prev_us = false;
        }
    }
    if out.is_empty() {
        "tracing_event".into()
    } else {
        out
    }
}

pub struct ActivityTraceLayer;

impl<S> Layer<S> for ActivityTraceLayer
where
    S: Subscriber,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let level = event.metadata().level();
        if matches!(*level, Level::TRACE | Level::DEBUG) {
            return;
        }
        let mut visitor = EventVisitor::new();
        event.record(&mut visitor);
        // Call sites that also call emit_event/emit_failure set ai_skip to avoid duplicates.
        if visitor.fields.contains_key("ai_skip") {
            return;
        }
        let target = event.metadata().target();
        let msg = if visitor.message.is_empty() {
            visitor
                .fields
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            visitor.message.clone()
        };
        let code = event_code_from_message(&msg);
        let mut ev =
            DiagEvent::new(DiagLevel::from(*level), target, code, msg).with_fields(visitor.fields);
        if let Some(corr) = ev.fields.remove("corr") {
            ev = ev.with_corr(corr);
        }
        // Avoid infinite loop: emit_event must not call tracing.
        diag_log::emit_event(ev);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    use tracing_subscriber::Registry;

    #[test]
    fn captures_warn_level_events() {
        let _guard = Registry::default().with(ActivityTraceLayer).set_default();

        let before = diag_log::recent_events(500).len();

        tracing::warn!(command = "unit_test", "something failed");

        let events = diag_log::recent_events(500);
        assert!(events.len() > before);
        assert!(events.iter().any(|e| e.msg.contains("something failed")
            && e.fields.get("command").map(String::as_str) == Some("unit_test")));
    }

    #[test]
    fn event_code_slug() {
        assert_eq!(event_code_from_message("Hello, World!"), "hello_world");
    }
}
