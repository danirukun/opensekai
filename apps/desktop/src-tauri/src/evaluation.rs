use crate::service::{RpcContext, ServiceHandle, ServicePorts};
use opensekai_contracts::*;
use opensekai_evaluation::{CaptureStore, RunManager};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tokio::{sync::Mutex as AsyncMutex, task::JoinHandle};

pub struct EvaluationIdentity {
    pub session_id: String,
    pub app_commit: String,
    pub fixture_id: String,
    pub evidence_root: PathBuf,
}
struct State {
    runs: RunManager,
    captures: CaptureStore,
    active: Option<(String, u64)>,
    attempts: VecDeque<(String, u64)>,
    exports: VecDeque<(String, &'static str)>,
}
pub struct NativeEvaluation {
    ports: ServicePorts,
    identity: EvaluationIdentity,
    state: Mutex<State>,
    flight: Arc<AsyncMutex<()>>,
    timer: Mutex<Option<JoinHandle<()>>>,
}
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
fn error(code: ErrorCode, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
        ids: vec![],
    }
}
fn decode<T: serde::de::DeserializeOwned>(call: Call) -> Result<T, AppError> {
    serde_json::from_value(call.params).map_err(|_| invalid("Invalid evaluation parameters"))
}
fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
impl NativeEvaluation {
    pub fn install(
        service: &ServiceHandle,
        mut identity: EvaluationIdentity,
    ) -> Result<Arc<Self>, AppError> {
        if identity.session_id != service.operator_descriptor().session_id
            || identity.fixture_id != "smoke_v1"
            || identity.app_commit.is_empty()
        {
            return Err(invalid("Invalid evaluation identity"));
        }
        if std::fs::symlink_metadata(&identity.evidence_root)
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err(invalid("Evidence directory cannot be a symlink"));
        }
        std::fs::create_dir_all(&identity.evidence_root)
            .map_err(|_| error(ErrorCode::Unavailable, "Cannot create evidence directory"))?;
        identity.evidence_root = identity
            .evidence_root
            .canonicalize()
            .map_err(|_| error(ErrorCode::Unavailable, "Cannot resolve evidence directory"))?;
        let evaluation = Arc::new(Self {
            ports: service.ports(),
            state: Mutex::new(State {
                runs: RunManager::new(),
                captures: CaptureStore::new(
                    identity.session_id.clone(),
                    identity.app_commit.clone(),
                    identity.fixture_id.clone(),
                ),
                active: None,
                attempts: VecDeque::new(),
                exports: VecDeque::new(),
            }),
            identity,
            flight: Arc::new(AsyncMutex::new(())),
            timer: Mutex::new(None),
        });
        let weak = Arc::downgrade(&evaluation);
        service.install_evaluation_handler(Arc::new(move |call, context| {
            let weak = weak.clone();
            Box::pin(async move {
                let Some(evaluation) = weak.upgrade() else {
                    return Reply::failure(error(ErrorCode::Unavailable, "Evaluation stopped"));
                };
                match call.method.as_str() {
                    "captureFrame" => evaluation.capture(call, context).await,
                    "benchmarkStart" | "benchmarkStatus" | "benchmarkCancel" => {
                        evaluation.run(call, context).await
                    }
                    "evidenceRead" => evaluation.evidence(call, context).await,
                    _ => Reply::failure(error(ErrorCode::Unsupported, "Unknown evaluation method")),
                }
            })
        }));
        let weak = Arc::downgrade(&evaluation);
        service.install_evidence_reader(Arc::new(move |id, filename| {
            weak.upgrade()
                .ok_or_else(|| error(ErrorCode::Unavailable, "Evaluation stopped"))?
                .read(id, filename)
        }));
        let weak = Arc::downgrade(&evaluation);
        *lock(&evaluation.timer) = Some(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let Some(evaluation) = weak.upgrade() else {
                    break;
                };
                let _ = tokio::task::spawn_blocking(move || evaluation.tick()).await;
            }
        }));
        Ok(evaluation)
    }
    pub fn shutdown(&self) {
        if let Some(timer) = lock(&self.timer).take() {
            timer.abort();
        }
    }
    fn export(&self, id: &str, filename: &str, bytes: &[u8]) -> Result<(), AppError> {
        if uuid::Uuid::parse_str(id).is_err() || !matches!(filename, "capture.png" | "summary.json")
        {
            return Err(invalid("Invalid evidence name"));
        }
        let root = &self.identity.evidence_root;
        if root.canonicalize().ok().as_ref() != Some(root)
            || std::fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err(invalid("Evidence root changed"));
        }
        let target = root.join(format!("{id}-{filename}"));
        if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(invalid("Evidence target cannot be a symlink"));
        }
        let mut file = tempfile::NamedTempFile::new_in(root)
            .map_err(|_| error(ErrorCode::Unavailable, "Cannot create evidence"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|_| error(ErrorCode::Unavailable, "Cannot protect evidence"))?;
        }
        file.write_all(bytes)
            .and_then(|()| file.as_file().sync_all())
            .map_err(|_| error(ErrorCode::Unavailable, "Cannot write evidence"))?;
        file.persist(target)
            .map_err(|_| error(ErrorCode::Unavailable, "Cannot publish evidence"))?;
        Ok(())
    }
    fn remove_export(&self, id: &str, filename: &str) {
        if self.identity.evidence_root.canonicalize().ok().as_ref()
            == Some(&self.identity.evidence_root)
            && uuid::Uuid::parse_str(id).is_ok()
        {
            let _ =
                std::fs::remove_file(self.identity.evidence_root.join(format!("{id}-{filename}")));
        }
    }
    fn prune_exports(&self, state: &mut State) {
        state.exports.retain(|(id, filename)| {
            let retained = if *filename == "capture.png" {
                state.captures.record(id).is_ok()
            } else {
                state.runs.summary(id).is_ok()
            };
            if !retained {
                self.remove_export(id, filename);
            }
            retained
        });
    }
    fn export_summary(&self, state: &mut State, id: &str) -> Result<(), AppError> {
        self.prune_exports(state);
        if state
            .exports
            .iter()
            .any(|(known, file)| known == id && *file == "summary.json")
        {
            return Ok(());
        }
        self.export(id, "summary.json", state.runs.summary(id)?)?;
        state.exports.push_back((id.into(), "summary.json"));
        Ok(())
    }
    fn tick(&self) {
        let mut state = lock(&self.state);
        let Some((id, sequence)) = state.active.clone() else {
            return;
        };
        let acknowledgements = self.ports.applied_since("output_main", sequence);
        let mut last = sequence;
        for (frame, received) in acknowledgements {
            last = frame.sequence;
            state.runs.observe(&frame, received);
        }
        state.active = Some((id.clone(), last));
        if let Ok(run) = state.runs.status(&id, self.ports.now_ms()) {
            if !matches!(run.state, RunState::Warming | RunState::Measuring) {
                state.active = None;
                let _ = self.export_summary(&mut state, &id);
            }
        }
    }
    pub async fn capture(self: &Arc<Self>, call: Call, context: RpcContext) -> Reply<Value> {
        let result = self.capture_inner(call, context).await;
        match result {
            Ok(record) => Reply::success(json!(record)),
            Err(error) => Reply::failure(error),
        }
    }
    async fn capture_inner(
        self: &Arc<Self>,
        call: Call,
        context: RpcContext,
    ) -> Result<CaptureRecord, AppError> {
        let params: CaptureParams = decode(call)?;
        params.validate()?;
        if params.output_id != "output_main" {
            return Err(error(
                ErrorCode::Forbidden,
                "Only main output can be captured",
            ));
        }
        let flight = self
            .flight
            .clone()
            .try_lock_owned()
            .map_err(|_| error(ErrorCode::Busy, "Capture or benchmark start in progress"))?;
        {
            let mut state = lock(&self.state);
            if state.runs.is_active() {
                return Err(error(ErrorCode::Busy, "Benchmark is active"));
            }
            let now = self.ports.now_ms();
            state
                .attempts
                .retain(|(_, at)| now.saturating_sub(*at) < 1000);
            if state
                .attempts
                .iter()
                .any(|(client, _)| client == &context.client_id)
            {
                return Err(error(ErrorCode::RateLimited, "Capture rate exceeded"));
            }
            if state.attempts.len() >= 1024 {
                return Err(error(ErrorCode::Busy, "Capture client budget exceeded"));
            }
            // Failed attempts consume the native per-client one-second budget too.
            state.attempts.push_back((context.client_id.clone(), now));
        }
        let (current, _) = self.ports.current_output("output_main")?;
        if current.revision != params.expected_revision {
            return Err(error(ErrorCode::Conflict, "Capture revision changed"));
        }
        let bytes = self.ports.request_capture(params.clone()).await?;
        let (ack, received) = self
            .ports
            .applied_at("output_main", bytes.frame.sequence)
            .ok_or_else(|| error(ErrorCode::StaleFrame, "Capture acknowledgement expired"))?;
        if ack != bytes.frame {
            return Err(error(
                ErrorCode::StaleFrame,
                "Capture acknowledgement mismatch",
            ));
        }
        let evaluation = self.clone();
        tokio::task::spawn_blocking(move || {
            let _flight = flight;
            let mut state = lock(&evaluation.state);
            let mut candidate = state.captures.clone();
            let record = candidate.insert(
                &context.client_id,
                params,
                bytes.frame.clone(),
                bytes.png.clone(),
                received,
                evaluation.ports.now_ms(),
                chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            )?;
            let checked = (|| {
                if record.width != bytes.width || record.height != bytes.height {
                    return Err(invalid("Capture image dimensions differ from metadata"));
                }
                evaluation.export(&record.id, "capture.png", &bytes.png)?;
                let (current, _) = evaluation.ports.current_output("output_main")?;
                if current.revision != bytes.frame.revision
                    || current.camera_id != bytes.frame.camera_id
                    || evaluation.ports.now_ms().saturating_sub(received) > 500
                {
                    return Err(error(
                        ErrorCode::StaleFrame,
                        "Capture expired during export",
                    ));
                }
                Ok(())
            })();
            if let Err(error) = checked {
                evaluation.remove_export(&record.id, "capture.png");
                evaluation.prune_exports(&mut state);
                return Err(error);
            }
            state.captures = candidate;
            state.exports.push_back((record.id.clone(), "capture.png"));
            evaluation.prune_exports(&mut state);
            Ok(record)
        })
        .await
        .map_err(|_| error(ErrorCode::Unavailable, "Capture validation failed"))?
    }
    pub async fn run(self: &Arc<Self>, call: Call, _context: RpcContext) -> Reply<Value> {
        let result = self.run_inner(call).await;
        match result {
            Ok(run) => Reply::success(json!(run)),
            Err(error) => Reply::failure(error),
        }
    }
    async fn run_inner(self: &Arc<Self>, call: Call) -> Result<BenchmarkRun, AppError> {
        if call.method == "benchmarkStart" {
            let params: BenchmarkParams = decode(call)?;
            params.validate()?;
            if let Some(replay) = lock(&self.state).runs.replay(&params) {
                return replay;
            }
            let _flight = self
                .flight
                .clone()
                .try_lock_owned()
                .map_err(|_| error(ErrorCode::Busy, "Capture in progress"))?;
            if lock(&self.state).runs.is_active() {
                return Err(error(ErrorCode::Busy, "Benchmark is active"));
            }
            self.ports.validate_smoke_fixture().await?;
            let (output, _) = self.ports.current_output("output_main")?;
            let mut state = lock(&self.state);
            let run = state.runs.start(params, self.ports.now_ms(), &output)?;
            state.active = Some((run.id.clone(), output.sequence));
            self.prune_exports(&mut state);
            return Ok(run);
        }
        let run_id = call
            .params
            .get("runId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("Missing run ID"))?
            .to_owned();
        let evaluation = self.clone();
        tokio::task::spawn_blocking(move || {
            evaluation.tick();
            let mut state = lock(&evaluation.state);
            let run = if call.method == "benchmarkCancel" {
                state.runs.cancel(&run_id)?
            } else {
                state.runs.status(&run_id, evaluation.ports.now_ms())?
            };
            if !matches!(run.state, RunState::Warming | RunState::Measuring) {
                if state.active.as_ref().is_some_and(|(id, _)| id == &run.id) {
                    state.active = None;
                }
                evaluation.export_summary(&mut state, &run.id)?;
            }
            Ok(run)
        })
        .await
        .map_err(|_| error(ErrorCode::Unavailable, "Benchmark dispatch failed"))?
    }
    fn summary_manifest(&self, state: &State, id: &str) -> Result<EvidenceManifest, AppError> {
        let bytes = state.runs.summary(id)?;
        Ok(EvidenceManifest {
            id: id.into(),
            kind: EvidenceKind::Benchmark,
            session_id: self.identity.session_id.clone(),
            fixture_id: FixtureId::SmokeV1,
            app_commit: self.identity.app_commit.clone(),
            resources: vec![EvidenceResource {
                uri: format!("opensekai://evidence/{id}/summary.json"),
                mime_type: "application/json".into(),
                sha256: hash(bytes),
                bytes: bytes.len() as u64,
            }],
        })
    }
    pub async fn evidence(&self, call: Call, _context: RpcContext) -> Reply<Value> {
        let Some(id) = call.params.get("evidenceId").and_then(Value::as_str) else {
            return Reply::failure(invalid("Missing evidence ID"));
        };
        let state = lock(&self.state);
        match state
            .captures
            .manifest(id)
            .or_else(|_| self.summary_manifest(&state, id))
        {
            Ok(manifest) => Reply::success(json!(manifest)),
            Err(error) => Reply::failure(error),
        }
    }
    fn read(&self, id: &str, filename: &str) -> Result<(Vec<u8>, &'static str), AppError> {
        let state = lock(&self.state);
        match filename {
            "capture.png" => Ok((state.captures.read(id)?.to_vec(), "image/png")),
            "summary.json" => Ok((state.runs.summary(id)?.to_vec(), "application/json")),
            _ => Err(invalid("Unknown evidence filename")),
        }
    }
}
impl Drop for NativeEvaluation {
    fn drop(&mut self) {
        self.shutdown();
    }
}
