//! When the Windows subsystem hides the console, startup failures are invisible.
//! We always append to the diagnostic log and show a native alert on Windows.
#![allow(unsafe_code)] // Win32 `MessageBoxW` is unsafe FFI (crate denies unsafe elsewhere).

use std::path::PathBuf;

pub fn fallback_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.nexttorrent.desktop")
}

pub fn report_fatal_startup(msg: &str) {
    let dir = fallback_config_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = crate::diag_log::append_failure(&dir, "fatal", msg);
    #[cfg(windows)]
    show_windows_alert(msg);
}

#[cfg(windows)]
fn show_windows_alert(message: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    const MAX_CHARS: usize = 900;
    let trimmed = if message.chars().count() > MAX_CHARS {
        let truncated: String = message.chars().take(MAX_CHARS).collect();
        format!("{truncated}…")
    } else {
        message.to_string()
    };

    let title = "Nexttorrent";
    let title_w: Vec<u16> = OsStr::new(title)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let message_w: Vec<u16> = OsStr::new(trimmed.as_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let hwnd: HWND = std::ptr::null_mut();
    unsafe {
        MessageBoxW(
            hwnd,
            message_w.as_ptr(),
            title_w.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}
