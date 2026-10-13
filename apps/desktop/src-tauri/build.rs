fn main() {
    use std::process::Command;
    println!("cargo:rerun-if-env-changed=OPENSEKAI_APP_COMMIT");
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|text| text.trim().to_owned())
    };
    let revision = std::env::var("OPENSEKAI_APP_COMMIT")
        .ok()
        .or_else(|| git(&["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".into());
    let valid = !revision.is_empty()
        && revision.len() <= 128
        && revision
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    assert!(valid, "Invalid build revision");
    println!("cargo:rustc-env=OPENSEKAI_APP_COMMIT={revision}");
    if let Some(head) = git(&["rev-parse", "--git-path", "HEAD"]) {
        println!("cargo:rerun-if-changed={head}");
    }
    if let Some(reference) = git(&["symbolic-ref", "--quiet", "HEAD"]) {
        if let Some(path) = git(&["rev-parse", "--git-path", &reference]) {
            println!("cargo:rerun-if-changed={path}");
        }
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "app_version",
            "bootstrap_session",
            "shutdown_session",
            "editor_connection",
            "show_editor",
            "show_scene",
            "hide_editor",
            "set_keystroke_capture",
            "open_input_monitoring_settings",
            "import_avatar",
            "import_scene",
            "save_show_as",
            "open_show",
            "import_blueprint_file",
            "export_blueprint_file",
        ]),
    ))
    .expect("OpenSekai build configuration failed");
}
