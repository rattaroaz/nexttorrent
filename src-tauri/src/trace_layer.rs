//! Tracing layer that mirrors log lines into the in-memory Activity buffer.

use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

use crate::diag_log;

struct EventVisitor {
    message: String,
    fields: Vec<String>,
}

impl EventVisitor {
    fn new() -> Self {
        Self {
            message: String::new(),
            fields: Vec::new(),
        }
    }

    fn into_line(self, level: &Level, target: &str) -> String {
        if !self.message.is_empty() {
            if self.fields.is_empty() {
                return format!("{level} {target} — {}", self.message);
            }
            return format!(
                "{level} {target} — {} ({})",
                self.message,
                self.fields.join(", ")
            );
        }
        if self.fields.is_empty() {
            return format!("{level} {target}");
        }
        format!("{level} {target} — {}", self.fields.join(", "))
    }
}

impl Visit for EventVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let name = field.name();
        let rendered = format!("{value:?}").trim_matches('"').to_string();
        if name == "message" {
            self.message = rendered;
        } else if !rendered.is_empty() {
            self.fields.push(format!("{name}={rendered}"));
        }
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
        let line = visitor.into_line(level, event.metadata().target());
        diag_log::push_trace_line(line);
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
        let _guard = Registry::default()
            .with(ActivityTraceLayer)
            .set_default();

        diag_log::push_trace_line("reset-marker".into());
        let before = diag_log::recent_trace_lines(500).len();

        tracing::warn!(command = "unit_test", "something failed");

        let lines = diag_log::recent_trace_lines(500);
        assert!(lines.len() > before);
        assert!(lines.iter().any(|l| l.contains("WARN") && l.contains("something failed")));
    }
}
