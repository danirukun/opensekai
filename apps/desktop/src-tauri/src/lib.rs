pub mod assets;
pub mod blueprint_file;
mod bootstrap;
pub mod evaluation;
pub mod input;
pub mod service;
mod show;
pub mod tracking;
use bootstrap::{DesktopState, NativeBootstrap, NativeEditorConnection};
use opensekai_contracts::{AppError, ErrorCode};
use std::{path::PathBuf, sync::Arc};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn output_resource_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().resource_dir()?.join("output"))
}

#[tauri::command]
async fn bootstrap_session(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<NativeBootstrap, AppError> {
    require_window_label(window.label(), "main")?;
    state.wait_ready().await
}
#[tauri::command]
async fn shutdown_session(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<(), AppError> {
    require_window_label(window.label(), "main")?;
    state.shutdown().await
}
fn require_window_label(actual: &str, expected: &str) -> Result<(), AppError> {
    if actual == expected {
        Ok(())
    } else {
        Err(AppError {
            code: ErrorCode::Forbidden,
            message: "Command is unavailable in this window".into(),
            ids: vec![],
        })
    }
}
#[tauri::command]
async fn editor_connection(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<NativeEditorConnection, AppError> {
    require_window_label(window.label(), "editor")?;
    state.editor_connection().await
}
#[tauri::command]
async fn import_avatar(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<Option<crate::assets::ImportResult>, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title("Import VRM avatar");
        // macOS can disable custom extensions through rfd's deprecated file-type filter.
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("VRM avatar", &["vrm"]);
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|_| AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    })?;
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|_| AppError {
        code: ErrorCode::InvalidInput,
        message: "Local file required".into(),
        ids: vec![],
    })?;
    state.import_avatar(path).await.map(Some)
}
#[tauri::command]
async fn save_show_as(
    window: tauri::WebviewWindow,
    document: serde_json::Value,
) -> Result<Option<String>, AppError> {
    require_window_label(window.label(), "editor")?;
    show::validate_show(&document)?;
    let name = document["name"].as_str().unwrap_or("OpenSekai Show");
    let filename = format!("{}.osekai", name.replace(['/', '\\', ':'], "-"));
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .set_title("Save OpenSekai show")
            .set_parent(&window)
            .set_file_name(&filename);
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("OpenSekai show", &["osekai"]);
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| AppError {
            code: ErrorCode::InvalidInput,
            message: "Local file required".into(),
            ids: vec![],
        })?;
        show::write_show(&path, &document)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    })?
}
#[tauri::command]
async fn open_show(window: tauri::WebviewWindow) -> Result<Option<serde_json::Value>, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title("Open OpenSekai show");
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("OpenSekai show", &["osekai"]);
        let Some(path) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| AppError {
            code: ErrorCode::InvalidInput,
            message: "Local file required".into(),
            ids: vec![],
        })?;
        show::read_show(&path).map(Some)
    })
    .await
    .map_err(|_| AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    })?
}
#[tauri::command]
async fn import_blueprint_file(window: tauri::WebviewWindow) -> Result<Option<String>, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title("Import Blueprint");
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("OpenSekai Blueprint", &["json"]);
        let Some(path) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| AppError {
            code: ErrorCode::InvalidInput,
            message: "Local file required".into(),
            ids: vec![],
        })?;
        blueprint_file::read_blueprint_file(&path).map(Some)
    })
    .await
    .map_err(|_| AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    })?
}
#[tauri::command]
async fn export_blueprint_file(
    window: tauri::WebviewWindow,
    name: String,
    text: String,
) -> Result<Option<String>, AppError> {
    require_window_label(window.label(), "editor")?;
    if text.len() as u64 > blueprint_file::MAX_BLUEPRINT_FILE_BYTES {
        return Err(AppError {
            code: ErrorCode::InvalidInput,
            message: "Blueprint file is too large".into(),
            ids: vec![],
        });
    }
    let filename = blueprint_file::blueprint_file_name(&name);
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .set_title("Export Blueprint")
            .set_parent(&window)
            .set_file_name(&filename);
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("OpenSekai Blueprint", &["json"]);
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| AppError {
            code: ErrorCode::InvalidInput,
            message: "Local file required".into(),
            ids: vec![],
        })?;
        blueprint_file::write_blueprint_file(&path, &text)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    })?
}
fn window_error(_: tauri::Error) -> AppError {
    AppError {
        code: ErrorCode::Unavailable,
        message: "Editor window is unavailable".into(),
        ids: vec![],
    }
}
#[tauri::command]
fn show_editor(window: tauri::WebviewWindow) -> Result<(), AppError> {
    require_window_label(window.label(), "main")?;
    let editor = window
        .get_webview_window("editor")
        .ok_or_else(|| AppError {
            code: ErrorCode::Unavailable,
            message: "Editor window is unavailable".into(),
            ids: vec![],
        })?;
    editor.show().map_err(window_error)?;
    editor.set_focus().map_err(window_error)
}
fn scene_window_unavailable() -> AppError {
    AppError {
        code: ErrorCode::Unavailable,
        message: "Scene window is unavailable".into(),
        ids: vec![],
    }
}
#[tauri::command]
fn show_scene(window: tauri::WebviewWindow) -> Result<(), AppError> {
    require_window_label(window.label(), "editor")?;
    let scene = window
        .get_webview_window("main")
        .ok_or_else(scene_window_unavailable)?;
    scene.show().map_err(|_| scene_window_unavailable())?;
    scene.unminimize().map_err(|_| scene_window_unavailable())?;
    scene.set_focus().map_err(|_| scene_window_unavailable())
}
#[tauri::command]
fn hide_editor(window: tauri::WebviewWindow) -> Result<(), AppError> {
    require_window_label(window.label(), "editor")?;
    window.hide().map_err(window_error)
}
#[tauri::command]
async fn set_keystroke_capture(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
    active: bool,
) -> Result<(), AppError> {
    require_window_label(window.label(), "editor")?;
    state.set_keystroke_capture(active).await;
    Ok(())
}
/// Opens the macOS Input Monitoring pane, where the operator allows held-key input.
#[tauri::command]
fn open_input_monitoring_settings(window: tauri::WebviewWindow) -> Result<(), AppError> {
    require_window_label(window.label(), "editor")?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
        .spawn()
        .map_err(|_| AppError {
            code: ErrorCode::Unavailable,
            message: "Settings unavailable".into(),
            ids: vec![],
        })?;
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = DesktopState::new();
    let startup = state.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    app.state::<Arc<DesktopState>>().keystroke(
                        shortcut.id(),
                        event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed,
                    );
                })
                .build(),
        )
        .manage(state.clone())
        .setup(move |app| {
            let data = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let output_root = output_resource_dir(app.handle())?;
            let asset_manifest = std::env::var_os("OPENSEKAI_FIXTURE_MANIFEST").map(PathBuf::from);
            startup.set_keystrokes(Arc::new(input::GlobalKeystrokes::new(app.handle().clone())));
            let runtime = startup.clone();
            tauri::async_runtime::spawn(async move {
                let asset_manifest = asset_manifest.unwrap_or_default();
                runtime
                    .initialize(
                        service::ServiceConfig {
                            output_root,
                            asset_manifest,
                            evidence_root: data.join("evidence"),
                            evaluation_enabled: std::env::var("OPENSEKAI_EVALUATION")
                                .is_ok_and(|value| value == "1"),
                        },
                        data,
                    )
                    .await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "editor" && matches!(event, tauri::WindowEvent::Focused(false)) {
                let state = window
                    .app_handle()
                    .state::<Arc<DesktopState>>()
                    .inner()
                    .clone();
                tauri::async_runtime::spawn(async move { state.end_keystroke_capture().await });
            }
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            bootstrap_session,
            shutdown_session,
            editor_connection,
            show_editor,
            show_scene,
            hide_editor,
            set_keystroke_capture,
            open_input_monitoring_settings,
            import_avatar,
            save_show_as,
            open_show,
            import_blueprint_file,
            export_blueprint_file
        ])
        .build(tauri::generate_context!())
        .expect("OpenSekai failed to start");
    app.run(move |_, event| {
        if let tauri::RunEvent::Exit = event {
            let _ = tauri::async_runtime::block_on(state.shutdown());
        }
    });
}

#[cfg(test)]
mod command_boundary_tests {
    use super::*;
    #[test]
    fn scene_focus_permission_is_granted_only_to_editor() {
        let editor: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/editor.json")).unwrap();
        let owner: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        assert_eq!(editor["windows"], serde_json::json!(["editor"]));
        assert!(editor["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "allow-show-scene"));
        assert!(!owner["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "allow-show-scene"));
        for permission in ["allow-save-show-as", "allow-open-show"] {
            assert!(editor["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == permission));
            assert!(!owner["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == permission));
        }
    }
    #[test]
    fn editor_commands_and_owner_commands_reject_other_window_labels() {
        assert!(require_window_label("main", "main").is_ok());
        assert!(require_window_label("editor", "editor").is_ok());
        for (actual, expected) in [
            ("editor", "main"),
            ("main", "editor"),
            ("remote", "editor"),
            ("", "main"),
        ] {
            assert_eq!(
                require_window_label(actual, expected).unwrap_err().code,
                ErrorCode::Forbidden
            );
        }
    }
}
