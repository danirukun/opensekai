//! The OS link adapter (B39 R3, R6): it gives each link from the OS, or from
//! `OPENSEKAI_OPEN_LINK`, to the inbox, and wakes the Editor window.
use super::inbox::LinkInbox;
use tauri::{AppHandle, Manager};

/// The startup variable of R6: one link, offered as if the OS gave it during launch.
const OPEN_LINK_VARIABLE: &str = "OPENSEKAI_OPEN_LINK";

/// Offers the link and, when the inbox keeps it, brings the window forward and sends `app-link`.
fn offer(app: &AppHandle, raw: &str) {
    if app.state::<LinkInbox>().offer_raw(raw) {
        crate::wake_main_window(app, "app-link", ());
    }
}

pub fn install(app: &AppHandle) {
    platform::install(app);
    if let Ok(raw) = std::env::var(OPEN_LINK_VARIABLE) {
        offer(app, &raw);
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use tauri::AppHandle;
    use tauri_plugin_deep_link::DeepLinkExt;

    /// macOS gives a link through `RunEvent::Opened`, at a cold start too; the plugin sends it to
    /// `on_open_url`. A link that the plugin already holds is offered one time here.
    pub fn install(app: &AppHandle) {
        let handle = app.clone();
        app.deep_link().on_open_url(move |event| {
            for url in event.urls() {
                super::offer(&handle, url.as_str());
            }
        });
        if let Ok(Some(urls)) = app.deep_link().get_current() {
            for url in urls {
                super::offer(app, url.as_str());
            }
        }
    }
}

/// Windows needs the link from argv and the single-instance plugin; Linux needs a desktop entry.
/// Neither target registers the scheme yet (B39 Safeguards).
#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn install(_app: &tauri::AppHandle) {}
}
