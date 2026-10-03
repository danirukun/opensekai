pub mod service;
pub mod assets;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn output_resource_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().resource_dir()?.join("output"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("OpenSekai failed to start");
}
