//! Time-of-day bandwidth scheduler layered on top of global settings.

use std::num::NonZeroU32;

use chrono::{Local, Timelike};

use crate::settings::NexttorrentSettings;

fn hour_in_slot(hour: u8, start: u8, end: u8) -> bool {
    if start == end {
        return false;
    }
    if start < end {
        hour >= start && hour < end
    } else {
        // overnight window, e.g. 22–6
        hour >= start || hour < end
    }
}

/// Effective limits after applying an optional scheduler slot for `when`.
pub fn effective_rate_limits(
    settings: &NexttorrentSettings,
    when: chrono::DateTime<Local>,
) -> (Option<NonZeroU32>, Option<NonZeroU32>) {
    let base_down = settings.global_down_limit_bps.and_then(NonZeroU32::new);
    let base_up = settings.global_up_limit_bps.and_then(NonZeroU32::new);

    if !settings.speed_scheduler.enabled {
        return (base_down, base_up);
    }

    let hour = when.hour() as u8;
    for slot in &settings.speed_scheduler.slots {
        if hour_in_slot(hour, slot.start_hour, slot.end_hour) {
            let d = slot
                .download_limit_bps
                .and_then(NonZeroU32::new)
                .or(base_down);
            let u = slot.upload_limit_bps.and_then(NonZeroU32::new).or(base_up);
            return (d, u);
        }
    }

    (base_down, base_up)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{NexttorrentSettings, SpeedScheduler, SpeedSchedulerSlot};
    use chrono::TimeZone;

    #[test]
    fn scheduler_overrides_limits_in_window() {
        let settings = NexttorrentSettings {
            global_down_limit_bps: Some(100),
            speed_scheduler: SpeedScheduler {
                enabled: true,
                slots: vec![SpeedSchedulerSlot {
                    start_hour: 10,
                    end_hour: 12,
                    download_limit_bps: Some(10),
                    upload_limit_bps: None,
                }],
            },
            ..Default::default()
        };

        let t = Local
            .with_ymd_and_hms(2024, 6, 15, 11, 0, 0)
            .single()
            .expect("valid local date");
        let (d, _) = effective_rate_limits(&settings, t);
        assert_eq!(d.map(|n| n.get()), Some(10));
    }
}
