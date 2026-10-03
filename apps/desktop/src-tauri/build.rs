fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "app_version",
            "bootstrap_session",
            "shutdown_session",
        ]),
    ))
    .expect("OpenSekai build configuration failed");
}
