use crate::service::{start_service, ServiceConfig, ServiceHandle};
use opensekai_contracts::{AppError, AssetRecord, ConnectionDescriptor, ErrorCode};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::{watch, Mutex};

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
    renderer_mode: &'static str,
}
#[derive(Default)]
struct Owned {
    service: Option<ServiceHandle>,
    stopped: bool,
}
pub struct DesktopState {
    owned: Mutex<Owned>,
    ready: watch::Sender<Option<Result<NativeBootstrap, AppError>>>,
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
        })
    }
    pub async fn initialize(self: Arc<Self>, config: ServiceConfig, descriptors: PathBuf) {
        let service = match start_service(config).await {
            Ok(service) => service,
            Err(error) => {
                self.ready.send_replace(Some(Err(error)));
                return;
            }
        };
        let info = (|| {
            let (operator, renderer) = service.write_descriptors(&descriptors, "output_main")?;
            Ok::<_, AppError>(NativeBootstrap {
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
                    "force-webgl2"
                } else {
                    "auto"
                },
            })
        })();
        match info {
            Ok(info) => {
                let mut owned = self.owned.lock().await;
                if owned.stopped {
                    drop(owned);
                    let _ = service.shutdown().await;
                    return;
                }
                owned.service = Some(service);
                self.ready.send_replace(Some(Ok(info)));
            }
            Err(error) => {
                let _ = service.shutdown().await;
                self.ready.send_replace(Some(Err(error)));
            }
        }
    }
    pub fn fail_startup(&self, error: AppError) {
        self.ready.send_replace(Some(Err(error)));
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
        let service = {
            let mut owned = self.owned.lock().await;
            owned.stopped = true;
            self.ready
                .send_replace(Some(Err(error(ErrorCode::Unavailable, "Session stopped"))));
            owned.service.take()
        };
        if let Some(service) = service {
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
}
