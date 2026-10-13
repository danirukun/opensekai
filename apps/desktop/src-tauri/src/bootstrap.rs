use crate::evaluation::{EvaluationIdentity, NativeEvaluation};
use crate::input::GlobalKeystrokes;
use crate::service::{start_service, ServiceConfig, ServiceHandle, ServicePorts};
use opensekai_contracts::{AppError, AssetRecord, ConnectionDescriptor, ErrorCode};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex, OnceLock},
    time::Duration,
};
use tokio::sync::{watch, Mutex};

#[derive(Clone, Copy, Serialize)]
enum RendererMode {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "force-webgl2")]
    ForceWebgl2,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBootstrap {
    publisher: ConnectionDescriptor,
    operator: ConnectionDescriptor,
    preview: ConnectionDescriptor,
    output: ConnectionDescriptor,
    operator_descriptor_file: String,
    renderer_descriptor_file: String,
    assets: Vec<AssetRecord>,
    renderer_mode: RendererMode,
    fixture_mode: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEditorConnection {
    operator: ConnectionDescriptor,
    output: ConnectionDescriptor,
    assets: Vec<AssetRecord>,
    renderer_mode: RendererMode,
}
#[derive(Default)]
struct Owned {
    service: Option<ServiceHandle>,
    evaluation: Option<Arc<NativeEvaluation>>,
    stopped: bool,
}
#[cfg(test)]
type StartupGate = (
    tokio::sync::oneshot::Sender<ConnectionDescriptor>,
    tokio::sync::oneshot::Receiver<()>,
);
pub struct DesktopState {
    owned: Mutex<Owned>,
    ready: watch::Sender<Option<Result<NativeBootstrap, AppError>>>,
    keystrokes: OnceLock<Arc<GlobalKeystrokes<tauri::Wry>>>,
    ports: StdMutex<Option<ServicePorts>>,
    #[cfg(test)]
    startup_gate: Mutex<Option<StartupGate>>,
}
fn error(code: ErrorCode, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
        ids: vec![],
    }
}
impl DesktopState {
    pub fn new() -> Arc<Self> {
        let (ready, _) = watch::channel(None);
        Arc::new(Self {
            owned: Mutex::new(Owned::default()),
            ready,
            keystrokes: OnceLock::new(),
            ports: StdMutex::new(None),
            #[cfg(test)]
            startup_gate: Mutex::new(None),
        })
    }
    pub fn set_keystrokes(&self, keystrokes: Arc<GlobalKeystrokes<tauri::Wry>>) {
        let _ = self.keystrokes.set(keystrokes);
    }
    /// Called from the global shortcut handler for each OS press or release.
    pub fn keystroke(&self, id: u32, pressed: bool) {
        let Some(accelerator) = self.keystrokes.get().and_then(|k| k.event(id, pressed)) else {
            return;
        };
        let ports = self.ports.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(ports) = ports {
            ports.push_keystroke(accelerator);
        }
    }
    /// Suspends or restores the global hotkeys while the editor captures a key.
    pub async fn set_keystroke_capture(&self, active: bool) {
        let ports = self.ports.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(ports) = ports {
            ports.set_keystroke_capture(active).await;
        }
    }
    /// Ends an active capture, for example when the editor loses focus.
    pub async fn end_keystroke_capture(&self) {
        let ports = self.ports.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(ports) = ports {
            ports.end_keystroke_capture().await;
        }
    }
    pub async fn initialize(self: Arc<Self>, config: ServiceConfig, descriptors: PathBuf) {
        // Initialization and shutdown share one lifecycle lock.
        let mut owned = self.owned.lock().await;
        if owned.stopped || owned.service.is_some() {
            return;
        }
        let fixture_mode = !config.asset_manifest.as_os_str().is_empty();
        let evaluation_enabled = config.evaluation_enabled;
        let evidence_root = config.evidence_root.clone();
        let service = match start_service(config).await {
            Ok(service) => service,
            Err(error) => {
                self.ready.send_replace(Some(Err(error)));
                return;
            }
        };
        #[cfg(test)]
        if let Some((acquired, release)) = self.startup_gate.lock().await.take() {
            let _ = acquired.send(service.operator_descriptor());
            let _ = release.await;
        }
        let evaluation = if evaluation_enabled {
            match NativeEvaluation::install(
                &service,
                EvaluationIdentity {
                    session_id: service.operator_descriptor().session_id,
                    app_commit: env!("OPENSEKAI_APP_COMMIT").into(),
                    fixture_id: "smoke_v1".into(),
                    evidence_root,
                },
            ) {
                Ok(evaluation) => Some(evaluation),
                Err(error) => {
                    let _ = service.shutdown().await;
                    self.ready.send_replace(Some(Err(error)));
                    return;
                }
            }
        } else {
            None
        };
        let info = (|| {
            let (operator, renderer) = service.write_descriptors(&descriptors, "output_main")?;
            Ok::<_, AppError>(NativeBootstrap {
                fixture_mode,
                publisher: service.publisher_descriptor(),
                operator: service.operator_descriptor(),
                preview: service.renderer_descriptor("preview_main")?,
                output: service.renderer_descriptor("output_main")?,
                operator_descriptor_file: operator.to_string_lossy().into_owned(),
                renderer_descriptor_file: renderer.to_string_lossy().into_owned(),
                assets: service.asset_records(),
                renderer_mode: if std::env::var("OPENSEKAI_RENDERER_BACKEND")
                    .is_ok_and(|value| value == "webgl2")
                {
                    RendererMode::ForceWebgl2
                } else {
                    RendererMode::Auto
                },
            })
        })();
        match info {
            Ok(info) => {
                if let Some(keystrokes) = self.keystrokes.get() {
                    service.ports().set_keystroke_registrar(keystrokes.clone());
                }
                service
                    .ports()
                    .set_key_monitor(crate::input::monitor::platform_monitor());
                *self.ports.lock().unwrap_or_else(|e| e.into_inner()) = Some(service.ports());
                owned.service = Some(service);
                owned.evaluation = evaluation;
                self.ready.send_replace(Some(Ok(info)));
            }
            Err(error) => {
                if let Some(evaluation) = evaluation {
                    evaluation.shutdown();
                }
                let _ = service.shutdown().await;
                self.ready.send_replace(Some(Err(error)));
            }
        }
    }
    pub async fn editor_connection(&self) -> Result<NativeEditorConnection, AppError> {
        let ready = self.wait_ready().await?;
        Ok(NativeEditorConnection {
            operator: ready.operator,
            output: ready.output,
            assets: self
                .owned
                .lock()
                .await
                .service
                .as_ref()
                .map(|s| s.asset_records())
                .unwrap_or(ready.assets),
            renderer_mode: ready.renderer_mode,
        })
    }
    pub async fn import_avatar(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        let owned = self.owned.lock().await;
        let service = owned
            .service
            .as_ref()
            .ok_or_else(|| error(ErrorCode::Unavailable, "Session unavailable"))?;
        service.import_avatar(path).await
    }
    pub async fn import_scene(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        let owned = self.owned.lock().await;
        let service = owned
            .service
            .as_ref()
            .ok_or_else(|| error(ErrorCode::Unavailable, "Session unavailable"))?;
        service.import_scene(path).await
    }
    pub async fn wait_ready(&self) -> Result<NativeBootstrap, AppError> {
        let mut receiver = self.ready.subscribe();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(result) = receiver.borrow_and_update().clone() {
                    return result;
                }
                receiver
                    .changed()
                    .await
                    .map_err(|_| error(ErrorCode::Unavailable, "Startup channel closed"))?;
            }
        })
        .await
        .map_err(|_| error(ErrorCode::Timeout, "Session startup timed out"))?
    }
    pub async fn shutdown(&self) -> Result<(), AppError> {
        // Keep the lifecycle lock until teardown completes so all callers wait.
        let mut owned = self.owned.lock().await;
        owned.stopped = true;
        self.ports.lock().unwrap_or_else(|e| e.into_inner()).take();
        self.ready
            .send_replace(Some(Err(error(ErrorCode::Unavailable, "Session stopped"))));
        if let Some(evaluation) = owned.evaluation.take() {
            evaluation.shutdown();
        }
        if let Some(service) = owned.service.take() {
            service.shutdown().await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn bootstrap_shutdown_is_idempotent_and_readiness_is_unavailable() {
        let state = DesktopState::new();
        state.shutdown().await.unwrap();
        state.shutdown().await.unwrap();
        assert_eq!(
            state.wait_ready().await.err().unwrap().code,
            ErrorCode::Unavailable
        );
    }
    #[tokio::test]
    async fn editor_projection_contains_only_connection_assets_and_safe_renderer_mode() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("manifest.json");
        std::fs::write(
            &manifest,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        let state = DesktopState::new();
        state
            .clone()
            .initialize(
                ServiceConfig {
                    output_root: dir.path().into(),
                    asset_manifest: manifest,
                    evidence_root: dir.path().join("evidence"),
                    evaluation_enabled: false,
                },
                dir.path().join("descriptors"),
            )
            .await;
        let owner = serde_json::to_value(state.wait_ready().await.unwrap()).unwrap();
        let editor = serde_json::to_value(state.editor_connection().await.unwrap()).unwrap();
        let keys: Vec<_> = editor
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["assets", "operator", "output", "rendererMode"]);
        assert_eq!(editor["rendererMode"], owner["rendererMode"]);
        assert_eq!(editor["operator"], owner["operator"]);
        assert_eq!(editor["output"], owner["output"]);
        assert_eq!(editor["assets"], owner["assets"]);
        assert_eq!(editor["operator"]["role"], "operator");
        assert_eq!(editor["output"]["role"], "renderer");
        // Vary the existing readiness preference without process-global environment races.
        let mut ready = state.wait_ready().await.unwrap();
        for (mode, expected) in [
            (RendererMode::Auto, "auto"),
            (RendererMode::ForceWebgl2, "force-webgl2"),
        ] {
            ready.renderer_mode = mode;
            state.ready.send_replace(Some(Ok(ready.clone())));
            let projected = serde_json::to_value(state.editor_connection().await.unwrap()).unwrap();
            assert_eq!(projected["rendererMode"], expected);
            assert_eq!(projected["operator"], owner["operator"]);
            assert_eq!(projected["output"], owner["output"]);
        }
        state.shutdown().await.unwrap();
        assert_eq!(
            state.editor_connection().await.err().unwrap().code,
            ErrorCode::Unavailable
        );
    }
    #[tokio::test]
    async fn bootstrap_reports_failed_asset_configuration() {
        let state = DesktopState::new();
        state
            .clone()
            .initialize(
                ServiceConfig {
                    output_root: PathBuf::from("absent-output"),
                    asset_manifest: PathBuf::from("absent-manifest"),
                    evidence_root: PathBuf::from("absent-evidence"),
                    evaluation_enabled: false,
                },
                PathBuf::from("absent-descriptors"),
            )
            .await;
        assert_eq!(
            state.wait_ready().await.err().unwrap().code,
            ErrorCode::NotFound
        );
    }
    // Real RPC boundary: bootstrap must install evaluation before readiness.
    #[tokio::test]
    async fn bootstrap_installs_evaluation_and_owns_shutdown() {
        use futures_util::{SinkExt, StreamExt};
        use serde_json::{json, Value};
        use tokio_tungstenite::{connect_async, tungstenite::Message};
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("manifest.json");
        std::fs::write(
            &manifest,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        let state = DesktopState::new();
        state
            .clone()
            .initialize(
                ServiceConfig {
                    output_root: dir.path().into(),
                    asset_manifest: manifest,
                    evidence_root: dir.path().join("evidence"),
                    evaluation_enabled: true,
                },
                dir.path().join("descriptors"),
            )
            .await;
        let info = state.wait_ready().await.unwrap();
        let (mut socket, _) = connect_async(&info.operator.ws_url).await.unwrap();
        socket.send(Message::Text(json!({"kind":"auth","role":"operator","token":info.operator.token,"schemaVersion":1,"outputId":null}).to_string().into())).await.unwrap();
        socket.next().await.unwrap().unwrap();
        socket.send(Message::Text(json!({"kind":"call","requestId":"probe","method":"evidenceRead","params":{"evidenceId":"00000000-0000-4000-8000-000000000000"}}).to_string().into())).await.unwrap();
        let response: Value =
            serde_json::from_str(&socket.next().await.unwrap().unwrap().into_text().unwrap())
                .unwrap();
        assert_eq!(response["result"]["error"]["code"], "NOT_FOUND");
        let (first, second) = tokio::join!(state.shutdown(), state.shutdown());
        first.unwrap();
        second.unwrap();
        let owned = state.owned.lock().await;
        assert!(owned.service.is_none());
        assert!(owned.evaluation.is_none());
        drop(owned);
        assert_eq!(
            state.wait_ready().await.err().unwrap().code,
            ErrorCode::Unavailable
        );
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), socket.next())
                .await
                .unwrap(),
            None | Some(Err(_)) | Some(Ok(Message::Close(_)))
        ));
    }
    #[tokio::test]
    async fn bootstrap_stopped_before_start_discards_native_resources() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("manifest.json");
        std::fs::write(
            &manifest,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        let state = DesktopState::new();
        state.shutdown().await.unwrap();
        state
            .clone()
            .initialize(
                ServiceConfig {
                    output_root: dir.path().into(),
                    asset_manifest: manifest,
                    evidence_root: dir.path().join("evidence"),
                    evaluation_enabled: true,
                },
                dir.path().join("descriptors"),
            )
            .await;
        let owned = state.owned.lock().await;
        assert!(owned.service.is_none());
        assert!(owned.evaluation.is_none());
        drop(owned);
        assert_eq!(
            state.wait_ready().await.err().unwrap().code,
            ErrorCode::Unavailable
        );
    }
    #[tokio::test]
    async fn bootstrap_evidence_install_failure_never_reports_ready() {
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("manifest.json");
        std::fs::write(
            &manifest,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        let evidence_root = dir.path().join("file");
        std::fs::write(&evidence_root, "occupied").unwrap();
        let state = DesktopState::new();
        state
            .clone()
            .initialize(
                ServiceConfig {
                    output_root: dir.path().into(),
                    asset_manifest: manifest,
                    evidence_root,
                    evaluation_enabled: true,
                },
                dir.path().join("descriptors"),
            )
            .await;
        assert_eq!(
            state.wait_ready().await.err().unwrap().code,
            ErrorCode::Unavailable
        );
        let owned = state.owned.lock().await;
        assert!(owned.service.is_none());
        assert!(owned.evaluation.is_none());
    }
    #[tokio::test]
    async fn bootstrap_shutdown_waits_for_in_flight_startup() {
        use futures_util::StreamExt;
        use tokio_tungstenite::{connect_async, tungstenite::Message};
        let dir = tempfile::tempdir().unwrap();
        let manifest = dir.path().join("manifest.json");
        std::fs::write(
            &manifest,
            r#"{"schemaVersion":1,"fixtureId":"smoke_v1","assets":[]}"#,
        )
        .unwrap();
        let state = DesktopState::new();
        let (acquired, receive) = tokio::sync::oneshot::channel();
        let (release, gate) = tokio::sync::oneshot::channel();
        *state.startup_gate.lock().await = Some((acquired, gate));
        let init = tokio::spawn(state.clone().initialize(
            ServiceConfig {
                output_root: dir.path().into(),
                asset_manifest: manifest,
                evidence_root: dir.path().join("evidence"),
                evaluation_enabled: true,
            },
            dir.path().join("descriptors"),
        ));
        let descriptor = receive.await.unwrap();
        let (mut socket, _) = connect_async(&descriptor.ws_url).await.unwrap();
        let stopping = state.clone();
        let mut stop = tokio::spawn(async move { stopping.shutdown().await });
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut stop)
                .await
                .is_err(),
            "shutdown returned while startup held a live service"
        );
        release.send(()).unwrap();
        init.await.unwrap();
        stop.await.unwrap().unwrap();
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), socket.next())
                .await
                .unwrap(),
            None | Some(Err(_)) | Some(Ok(Message::Close(_)))
        ));
        let owned = state.owned.lock().await;
        assert!(owned.service.is_none());
        assert!(owned.evaluation.is_none());
    }
}
#[cfg(test)]
mod normal_tests {
    use super::*;
    #[tokio::test]
    async fn normal_bootstrap_needs_no_fixture_and_operator_can_edit() {
        let dir = tempfile::tempdir().unwrap();
        let state = DesktopState::new();
        state
            .clone()
            .initialize(
                ServiceConfig {
                    output_root: dir.path().into(),
                    asset_manifest: PathBuf::new(),
                    evidence_root: dir.path().join("evidence"),
                    evaluation_enabled: false,
                },
                dir.path().join("descriptors"),
            )
            .await;
        let owner = state.wait_ready().await.unwrap();
        assert!(!owner.fixture_mode);
        assert!(owner.assets.is_empty());
        assert!(owner
            .operator
            .capabilities
            .contains(&opensekai_contracts::Capability::Edit));
        state.shutdown().await.unwrap();
    }
}
