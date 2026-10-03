pub mod assets;
mod bootstrap;
pub mod service;
use bootstrap::{DesktopState, NativeBootstrap};
use opensekai_contracts::{AppError, ErrorCode};
use std::{path::PathBuf, sync::Arc};
use tauri::Manager;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn output_resource_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().resource_dir()?.join("output"))
}

#[tauri::command]
async fn bootstrap_session(
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<NativeBootstrap, AppError> {
    state.wait_ready().await
}
#[tauri::command]
async fn shutdown_session(state: tauri::State<'_, Arc<DesktopState>>) -> Result<(), AppError> {
    state.shutdown().await
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = DesktopState::new();
    let startup = state.clone();
    let app = tauri::Builder::default()
        .manage(state.clone())
        .setup(move |app| {
            let data = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let output_root = output_resource_dir(app.handle())?;
            let asset_manifest = std::env::var_os("OPENSEKAI_FIXTURE_MANIFEST").map(PathBuf::from);
            let runtime = startup.clone();
            tauri::async_runtime::spawn(async move {
                let Some(asset_manifest) = asset_manifest else {
                    runtime.fail_startup(AppError {
                        code: ErrorCode::NotFound,
                        message: "Set OPENSEKAI_FIXTURE_MANIFEST to the local fixture manifest"
                            .into(),
                        ids: vec![],
                    });
                    return;
                };
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
        .invoke_handler(tauri::generate_handler![
            app_version,
            bootstrap_session,
            shutdown_session
        ])
        .build(tauri::generate_context!())
        .expect("OpenSekai failed to start");
    app.run(move |_, event| {
        if let tauri::RunEvent::Exit = event {
            let _ = tauri::async_runtime::block_on(state.shutdown());
        }
    });
}
