//! System tray icon and menu (Show / Pause all / Resume all / Quit).

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use crate::state::AppState;

const ID_SHOW: &str = "tray_show";
const ID_PAUSE_ALL: &str = "tray_pause_all";
const ID_RESUME_ALL: &str = "tray_resume_all";
const ID_QUIT: &str = "tray_quit";

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id(ID_SHOW, "Show Nexttorrent").build(app)?;
    let pause_all = MenuItemBuilder::with_id(ID_PAUSE_ALL, "Pause all").build(app)?;
    let resume_all = MenuItemBuilder::with_id(ID_RESUME_ALL, "Resume all").build(app)?;
    let quit = MenuItemBuilder::with_id(ID_QUIT, "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &pause_all, &resume_all, &quit])
        .build()?;

    let icon = app
        .default_window_icon()
        .ok_or("no default window icon for tray")?
        .clone();

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Nexttorrent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                ID_SHOW => show_main_window(app),
                ID_PAUSE_ALL => {
                    let handle = app.clone();
                    let Some(s) = handle
                        .try_state::<AppState>()
                        .map(|state| state.inner().clone())
                    else {
                        return;
                    };
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::torrent_commands::pause_all_impl(&s).await;
                    });
                }
                ID_RESUME_ALL => {
                    let handle = app.clone();
                    let Some(s) = handle
                        .try_state::<AppState>()
                        .map(|state| state.inner().clone())
                    else {
                        return;
                    };
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::torrent_commands::resume_all_impl(&s).await;
                    });
                }
                ID_QUIT => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
