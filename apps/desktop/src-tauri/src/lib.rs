pub mod assets;
pub mod blueprint_file;
mod bootstrap;
pub mod evaluation;
pub mod input;
mod local_file;
pub mod screenshots;
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
/// Sends a new or replaced record to the Scene window, so the session sees the expressions of a new model.
fn announce_record(window: &tauri::WebviewWindow, record: &opensekai_contracts::AssetRecord) {
    use tauri::Emitter;
    let _ = window.app_handle().emit_to("main", "asset-record", record);
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
    let result = state.import_avatar(path).await?;
    announce_record(&window, &result.record);
    Ok(Some(result))
}
#[tauri::command]
async fn import_scene(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<Option<crate::assets::ImportResult>, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title("Import environment");
        // macOS can disable custom extensions through rfd's deprecated file-type filter.
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("Environment", &["glb", "gltf", "zip"]);
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
    let result = state.import_scene(path).await?;
    announce_record(&window, &result.record);
    Ok(Some(result))
}
fn local_path(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf, AppError> {
    path.into_path().map_err(|_| AppError {
        code: ErrorCode::InvalidInput,
        message: "Local file required".into(),
        ids: vec![],
    })
}
fn chooser_unavailable<E>(_: E) -> AppError {
    AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    }
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
        let path = local_path(path)?;
        show::write_show(&path, &document)?;
        app.state::<show::ShowFile>().set_path(path.clone());
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(chooser_unavailable)?
}
/// Saves to the file from the last Open or Save As. Without one, it asks like Save As.
#[tauri::command]
async fn save_show(
    window: tauri::WebviewWindow,
    show_file: tauri::State<'_, show::ShowFile>,
    document: serde_json::Value,
) -> Result<Option<String>, AppError> {
    require_window_label(window.label(), "editor")?;
    let Some(path) = show_file.path() else {
        return save_show_as(window, document).await;
    };
    tauri::async_runtime::spawn_blocking(move || {
        show::write_show(&path, &document)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(chooser_unavailable)?
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
        let path = local_path(path)?;
        let document = show::read_show(&path)?;
        app.state::<show::ShowFile>().set_path(path);
        Ok(Some(document))
    })
    .await
    .map_err(chooser_unavailable)?
}
#[tauri::command]
fn set_show_dirty(
    window: tauri::WebviewWindow,
    show_file: tauri::State<'_, show::ShowFile>,
    dirty: bool,
) -> Result<(), AppError> {
    require_window_label(window.label(), "editor")?;
    show_file.set_dirty(dirty);
    Ok(())
}
/// Asks before the editor closes with unsaved changes: `save`, `discard`, or `cancel`.
#[tauri::command]
async fn confirm_close_editor(window: tauri::WebviewWindow) -> Result<&'static str, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogResult};
        let result = app
            .dialog()
            .message("Save changes to the show before closing?")
            .title("Unsaved changes")
            .parent(&window)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                "Save".into(),
                "Don't Save".into(),
                "Cancel".into(),
            ))
            .blocking_show_with_result();
        match result {
            MessageDialogResult::Yes => "save",
            MessageDialogResult::Custom(label) if label == "Save" => "save",
            MessageDialogResult::No => "discard",
            MessageDialogResult::Custom(label) if label == "Don't Save" => "discard",
            _ => "cancel",
        }
    })
    .await
    .map_err(chooser_unavailable)
}
const QUIT_MENU_ID: &str = "opensekai-quit";
/// Menu item ID, `show-command` payload, label, and accelerator for each File menu show action.
const SHOW_MENU: [(&str, &str, &str); 3] = [
    ("open", "Open Show…", "CmdOrCtrl+O"),
    ("save", "Save Show", "CmdOrCtrl+S"),
    ("saveAs", "Save Show As…", "CmdOrCtrl+Shift+S"),
];
fn install_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let menu = Menu::default(app)?;
    let submenus: Vec<_> = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .collect();
    if let Some(file) = submenus
        .iter()
        .find(|submenu| submenu.text().is_ok_and(|text| text == "File"))
    {
        for (position, (id, label, accelerator)) in SHOW_MENU.into_iter().enumerate() {
            file.insert(
                &MenuItem::with_id(app, id, label, true, Some(accelerator))?,
                position,
            )?;
        }
        file.insert(&PredefinedMenuItem::separator(app)?, SHOW_MENU.len())?;
    }
    // tao does not ask before the stock Quit item (`terminate:`) ends the app, so Command+Q
    // would skip `ExitRequested`. A custom item sends Quit through `request_quit`.
    #[cfg(target_os = "macos")]
    if let Some(app_menu) = submenus.first() {
        let quit = app_menu
            .items()?
            .last()
            .and_then(|item| item.as_predefined_menuitem().cloned())
            .filter(|item| item.text().is_ok_and(|text| text.starts_with("Quit")));
        if let Some(quit) = quit {
            app_menu.remove(&quit)?;
        }
        let label = format!("Quit {}", app.package_info().name);
        app_menu.append(&MenuItem::with_id(
            app,
            QUIT_MENU_ID,
            label,
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
    }
    app.set_menu(menu)?;
    Ok(())
}
/// Brings the editor forward and asks it to run a show command, so the editor builds the document.
fn send_show_command(app: &tauri::AppHandle, command: &str) {
    use tauri::Emitter;
    let Some(editor) = app.get_webview_window("editor") else {
        return;
    };
    let _ = editor.show();
    let _ = editor.set_focus();
    let _ = app.emit_to("editor", "show-command", command);
}
/// Quits now, or first asks when the show has unsaved changes.
fn request_quit(app: &tauri::AppHandle) {
    let show_file = app.state::<show::ShowFile>();
    if !show_file.quit_needs_confirmation() {
        show_file.confirm_quit();
        app.exit(0);
        return;
    }
    let app = app.clone();
    app.dialog()
        .message("Quit without saving the show?")
        .title("Unsaved changes")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Cancel".into(),
        ))
        .show(move |quit| {
            if quit {
                app.state::<show::ShowFile>().confirm_quit();
                app.exit(0);
            }
        });
}
#[tauri::command]
async fn import_blueprint_file(window: tauri::WebviewWindow) -> Result<Option<String>, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app
            .dialog()
            .file()
            .set_title("Import Blueprint")
            .set_parent(&window);
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
/// Creates the screenshot folder and opens it in the file manager. It takes no path.
#[tauri::command]
fn open_screenshots_folder(window: tauri::WebviewWindow) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    require_window_label(window.label(), "editor")?;
    let unavailable = || AppError {
        code: ErrorCode::Unavailable,
        message: "Screenshots folder unavailable".into(),
        ids: vec![],
    };
    let data = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|_| unavailable())?;
    let folder = screenshots::folder(&data);
    std::fs::create_dir_all(&folder).map_err(|_| unavailable())?;
    window
        .app_handle()
        .opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|_| unavailable())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = DesktopState::new();
    let startup = state.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
        .manage(show::ShowFile::default())
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == QUIT_MENU_ID {
                request_quit(app);
            } else if let Some((command, ..)) =
                SHOW_MENU.iter().find(|(command, ..)| *command == id)
            {
                send_show_command(app, command);
            }
        })
        .setup(move |app| {
            install_menu(app.handle())?;
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
            if let ("main", tauri::WindowEvent::CloseRequested { api, .. }) =
                (window.label(), event)
            {
                api.prevent_close();
                request_quit(window.app_handle());
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
            open_screenshots_folder,
            import_avatar,
            import_scene,
            save_show,
            save_show_as,
            open_show,
            set_show_dirty,
            confirm_close_editor,
            import_blueprint_file,
            export_blueprint_file
        ])
        .build(tauri::generate_context!())
        .expect("OpenSekai failed to start");
    app.run(move |app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if app.state::<show::ShowFile>().quit_needs_confirmation() {
                api.prevent_exit();
                request_quit(app);
            }
        }
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
        // The editor opens the screenshot folder only through the command; no window gets `opener:`.
        for capability in [&editor, &owner] {
            assert!(!capability["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p.as_str().is_some_and(|p| p.starts_with("opener:"))));
        }
        for permission in [
            "allow-save-show-as",
            "allow-open-show",
            "allow-open-screenshots-folder",
        ] {
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
