use super::*;
use crate::input::devices::DeviceStatus;
use crate::input::monitor::MonitorStatus;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{future::Future, pin::Pin};

/// The status warning while held-key nodes are active but keys cannot be observed.
fn monitor_warning(watching: bool, status: MonitorStatus) -> Option<AppError> {
    let (code, message) = match (watching, status) {
        (true, MonitorStatus::NoAccess) => (ErrorCode::Forbidden, "Input Monitoring is off"),
        (true, MonitorStatus::Unsupported) => (
            ErrorCode::Unsupported,
            "Held keys are unavailable on this platform",
        ),
        _ => return None,
    };
    Some(AppError {
        code,
        message: message.into(),
        ids: vec!["input-monitoring".into()],
    })
}
/// The status warning for a used device kind that cannot give input (R10).
fn device_warning(kind: DeviceKind, status: DeviceStatus) -> AppError {
    let (id, message) = match kind {
        DeviceKind::Gamepad => ("device-gamepad", "Gamepad input is unavailable"),
        DeviceKind::Midi => ("device-midi", "MIDI input is unavailable"),
        DeviceKind::Pointer => ("device-pointer", "Pointer input is unavailable"),
    };
    AppError {
        code: if status == DeviceStatus::Unsupported {
            ErrorCode::Unsupported
        } else {
            ErrorCode::Unavailable
        },
        message: message.into(),
        ids: vec![id.into()],
    }
}
/// The computer addresses for the iFacialMocap Inspector (R7): the IPv4 addresses of up,
/// non-loopback, non-link-local interfaces, at most 8, in numeric order.
fn local_addresses(interfaces: impl IntoIterator<Item = (std::net::IpAddr, bool)>) -> Vec<String> {
    let mut addresses: Vec<std::net::Ipv4Addr> = interfaces
        .into_iter()
        .filter_map(|(ip, up)| match ip {
            std::net::IpAddr::V4(v4)
                if up && !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() =>
            {
                Some(v4)
            }
            _ => None,
        })
        .collect();
    addresses.sort();
    addresses.dedup();
    addresses
        .into_iter()
        .take(8)
        .map(|a| a.to_string())
        .collect()
}
/// Reads the interfaces with `if-addrs`; "up" is its operational status (`IFF_RUNNING` on
/// macOS and Linux, `OperStatus` on Windows).
pub(crate) fn computer_addresses() -> Vec<String> {
    if_addrs::get_if_addrs()
        .map(|list| local_addresses(list.iter().map(|i| (i.ip(), i.is_oper_up()))))
        .unwrap_or_default()
}
#[derive(Debug, Clone)]
pub struct RpcContext {
    pub client_id: String,
}
pub type RpcHandler = Arc<
    dyn Fn(Call, RpcContext) -> Pin<Box<dyn Future<Output = Reply<Value>> + Send>> + Send + Sync,
>;
struct PendingGuard<'a> {
    shared: &'a Shared,
    id: String,
}
impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        lock(&self.shared.inner).pending.remove(&self.id);
    }
}
/// The wire message kind that may answer a pending relay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ReplyKind {
    Call,
    Capture,
    Screenshot,
}
impl ReplyKind {
    fn of(method: &str) -> Self {
        match method {
            "nativeCapture" => Self::Capture,
            "cameraScreenshot" => Self::Screenshot,
            _ => Self::Call,
        }
    }
}
impl Shared {
    pub(super) async fn relay(
        &self,
        owner: &str,
        target: Connection,
        method: &str,
        message: impl FnOnce(String) -> Value,
    ) -> Result<Value, AppError> {
        self.relay_within(owner, target, method, Duration::from_secs(2), message)
            .await
    }
    pub(super) async fn relay_within(
        &self,
        owner: &str,
        target: Connection,
        method: &str,
        timeout: Duration,
        message: impl FnOnce(String) -> Value,
    ) -> Result<Value, AppError> {
        let id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        {
            let mut inner = lock(&self.inner);
            if *self.stop.borrow() {
                return Err(err(ErrorCode::Unavailable, "Service stopped"));
            }
            if inner.pending.values().filter(|p| p.owner == owner).count() >= PENDING_CAPACITY {
                return Err(err(ErrorCode::RateLimited, "Too many pending calls"));
            }
            inner.pending.insert(
                id.clone(),
                Pending {
                    owner: owner.into(),
                    target: target.id.clone(),
                    method: method.into(),
                    reply: tx,
                },
            );
        }
        let _pending_guard = PendingGuard {
            shared: self,
            id: id.clone(),
        };
        if let Err(error) = Self::send(&target, message(id.clone())) {
            lock(&self.inner).pending.remove(&id);
            return Err(error);
        }
        let result = tokio::time::timeout(timeout, rx).await;
        lock(&self.inner).pending.remove(&id);
        match result {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(err(ErrorCode::Unavailable, "Reply channel closed")),
            Err(_) => Err(err(ErrorCode::Timeout, "RPC timed out")),
        }
    }
    pub(super) fn accept_reply(&self, connection: &str, id: &str, result: Value, kind: ReplyKind) {
        let mut inner = lock(&self.inner);
        let Some(pending) = inner.pending.get(id) else {
            return;
        };
        if pending.target != connection || ReplyKind::of(&pending.method) != kind {
            return;
        }
        // `parse_wire` already checked a screenshot reply and its data on receipt.
        let valid = if kind == ReplyKind::Screenshot {
            Ok(())
        } else if kind == ReplyKind::Capture {
            parse_wire(
                json!(WireMessage::CaptureReply {
                    request_id: id.into(),
                    result: result.clone()
                })
                .to_string()
                .as_bytes(),
            )
            .map(|_| ())
        } else {
            validate_result(&pending.method, &result)
        };
        if let Some(pending) = inner.pending.remove(id) {
            let _ = pending.reply.send(valid.map(|_| result));
        }
    }
    /// Fails a pending screenshot with `error` when this renderer sent a reply that did not
    /// pass the wire checks. Returns false when no such request is pending.
    pub(super) fn reject_screenshot_reply(
        &self,
        connection: &str,
        id: &str,
        error: AppError,
    ) -> bool {
        let mut inner = lock(&self.inner);
        let matches = inner.pending.get(id).is_some_and(|pending| {
            pending.target == connection && ReplyKind::of(&pending.method) == ReplyKind::Screenshot
        });
        if matches {
            if let Some(pending) = inner.pending.remove(id) {
                let _ = pending.reply.send(Err(error));
            }
        }
        matches
    }
    pub(super) async fn route_scene_call(&self, call: Call, client_id: &str) -> Reply<Value> {
        if let Err(error) = call.validate() {
            return Reply::failure(error);
        }
        if !matches!(
            call.method.as_str(),
            "sceneInspect"
                | "scenePatch"
                | "sceneReplace"
                | "cameraSelect"
                | "blueprintRun"
                | "blueprintEdit"
                | "blueprintInspect"
                | "blueprintDebug"
                | "trackingProbe"
                | "expressionGet"
                | "expressionSet"
        ) {
            return Reply::failure(err(ErrorCode::Unsupported, "Not a scene command"));
        }
        let target = lock(&self.inner).publisher.clone();
        let Some(target) = target else {
            return Reply::failure(err(ErrorCode::Unavailable, "Publisher disconnected"));
        };
        let method = call.method.clone();
        let publisher_id = target.id.clone();
        match self
            .relay(client_id, target, &method, |request_id| {
                json!(WireMessage::Call {
                    request_id,
                    method: call.method,
                    params: call.params
                })
            })
            .await
        {
            Ok(result) => {
                if method == "blueprintEdit" {
                    if let Some(data) = result
                        .get("data")
                        .and_then(|d| serde_json::from_value::<BlueprintEditResult>(d.clone()).ok())
                    {
                        let current = lock(&self.inner).publisher.as_ref().map(|p| &p.id)
                            == Some(&publisher_id);
                        if current
                            && self.learn_keystrokes(
                                &publisher_id,
                                data.revision,
                                data.keystrokes.into_iter().collect(),
                                data.held_keys.into_iter().collect(),
                                data.devices.unwrap_or_default().into_iter().collect(),
                            )
                        {
                            self.sync_keystrokes().await;
                        }
                    }
                }
                serde_json::from_value(result)
                    .unwrap_or_else(|_| Reply::failure(invalid("Invalid publisher reply")))
            }
            Err(error) => Reply::failure(error),
        }
    }
    pub(super) async fn route_call(
        &self,
        call: Call,
        client_id: &str,
        role: &Role,
        capabilities: &[Capability],
    ) -> Reply<Value> {
        if let Err(error) = call.validate() {
            return Reply::failure(error);
        }
        if *role != Role::Operator {
            return Reply::failure(err(ErrorCode::Forbidden, "Role cannot call methods"));
        }
        let required = match call.method.as_str() {
            "scenePatch" | "sceneReplace" | "cameraSelect" | "blueprintRun" | "blueprintEdit"
            | "expressionSet" | "cameraScreenshot" => Capability::Edit,
            "captureFrame" => Capability::Capture,
            "benchmarkStart" | "benchmarkCancel" => Capability::Benchmark,
            _ => Capability::Read,
        };
        if !capabilities.contains(&required) {
            return Reply::failure(err(ErrorCode::Forbidden, "Capability denied"));
        }
        if call.method == "appStatus" {
            // Read before `inner`: relearn_keystrokes takes keystrokes_known before inner.
            let watching = !lock(&self.keystrokes_known).watched.is_empty();
            let monitor = lock(&self.monitor).clone().status();
            let device_problems = lock(&self.devices).clone().problems();
            let inner = lock(&self.inner);
            let outputs = inner
                .tickets
                .keys()
                .map(|id| OutputStatus {
                    output_id: id.clone(),
                    connected: inner.renderers.contains_key(id),
                    last_frame: inner
                        .acks
                        .get(id)
                        .and_then(|q| q.back().map(|(f, _)| f.clone())),
                })
                .collect();
            let current = inner.renderers.contains_key("output_main")
                && inner.latest.as_ref().is_some_and(|latest| {
                    inner
                        .acks
                        .get("output_main")
                        .and_then(|q| q.back())
                        .is_some_and(|(ack, received_at_ms)| {
                            ack.revision == latest.scene.revision
                                && ack.session_id == latest.session_id
                                && self.now_ms().saturating_sub(*received_at_ms) <= 500
                        })
                });
            return Reply::success(json!(AppStatus {
                schema_version: 1,
                session_id: self.session.clone(),
                ready: inner.publisher.is_some() && current,
                revision: inner.latest.as_ref().map(|f| f.scene.revision),
                capabilities: capabilities.to_vec(),
                warnings: lock(&self.keystroke_warnings)
                    .iter()
                    .map(|accelerator| AppError {
                        code: ErrorCode::Unavailable,
                        message: "Keystroke unavailable".into(),
                        ids: vec![accelerator.clone()],
                    })
                    .chain(monitor_warning(
                        watching && inner.publisher.is_some(),
                        monitor
                    ))
                    .chain(
                        device_problems
                            .into_iter()
                            .filter(|_| inner.publisher.is_some())
                            .map(|(kind, status)| device_warning(kind, status))
                    )
                    .collect(),
                outputs,
                tracking_status: inner
                    .latest
                    .as_ref()
                    .and_then(|f| f.tracking_status.clone()),
                blueprint_revision: inner.latest.as_ref().and_then(|f| f.blueprint_revision),
                local_addresses: Some(computer_addresses()),
                vmc_senders: Some(self.vmc_senders.statuses()).filter(|list| !list.is_empty()),
            }));
        }
        if call.method == "cameraScreenshot" {
            let reply = match serde_json::from_value::<CameraScreenshotParams>(call.params) {
                Ok(params) => match self.screenshot(client_id, params).await {
                    Ok(result) => Reply::success(json!(result)),
                    Err(error) => Reply::failure(error),
                },
                Err(_) => Reply::failure(invalid("Invalid screenshot call")),
            };
            return match validate_result("cameraScreenshot", &json!(reply)) {
                Ok(()) => reply,
                Err(error) => Reply::failure(error),
            };
        }
        if call.method == "assetList" {
            // The host owns the asset library, so it answers without the publisher.
            let after = call.params.get("after").and_then(Value::as_str);
            let records = lock(&self.registry).records();
            return Reply::success(json!(opensekai_contracts::AssetList::page(&records, after)));
        }
        if matches!(
            call.method.as_str(),
            "sceneInspect"
                | "scenePatch"
                | "sceneReplace"
                | "cameraSelect"
                | "blueprintRun"
                | "blueprintEdit"
                | "blueprintInspect"
                | "blueprintDebug"
                | "trackingProbe"
                | "expressionGet"
                | "expressionSet"
        ) {
            return self.route_scene_call(call, client_id).await;
        }
        // Installation is the Task 10 gate; no placeholder evaluation success is possible.
        let handler = lock(&self.inner).handler.clone();
        let Some(handler) = handler else {
            return Reply::failure(err(ErrorCode::Unsupported, "Evaluation is unavailable"));
        };
        let method = call.method.clone();
        let result = match tokio::time::timeout(
            Duration::from_secs(2),
            handler(
                call,
                RpcContext {
                    client_id: client_id.into(),
                },
            ),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => return Reply::failure(err(ErrorCode::Timeout, "Evaluation timed out")),
        };
        match validate_result(&method, &json!(result)) {
            Ok(()) => result,
            Err(error) => Reply::failure(error),
        }
    }
    pub(super) async fn capture(&self, params: CaptureParams) -> Result<CaptureBytes, AppError> {
        params.validate()?;
        let target = lock(&self.inner)
            .renderers
            .get(&params.output_id)
            .cloned()
            .ok_or_else(|| err(ErrorCode::Unavailable, "Renderer disconnected"))?;
        let output = params.output_id.clone();
        let revision = params.expected_revision;
        let result = self
            .relay("nativeCapture", target, "nativeCapture", |request_id| {
                json!(WireMessage::CaptureRequest { request_id, params })
            })
            .await?;
        let reply: Reply<CaptureReplyData> =
            serde_json::from_value(result).map_err(|_| invalid("Invalid capture reply"))?;
        match reply {
            Reply::Failure(f) => Err(f.error),
            Reply::Success(s) => {
                let data = s.data;
                let frame = &data.metadata.frame;
                if frame.output_id != output
                    || frame.revision != revision
                    || frame.session_id != self.session
                {
                    return Err(err(
                        ErrorCode::StaleFrame,
                        "Capture frame does not match request",
                    ));
                }
                let inner = lock(&self.inner);
                let acknowledged = inner
                    .acks
                    .get(&output)
                    .and_then(|ring| ring.iter().find(|(ack, _)| ack == frame));
                if acknowledged.is_none_or(|(_, at)| self.now_ms().saturating_sub(*at) > 500) {
                    return Err(err(ErrorCode::StaleFrame, "Capture frame is not current"));
                }
                let png = STANDARD
                    .decode(data.png_base64)
                    .map_err(|_| invalid("Invalid capture PNG encoding"))?;
                let bytes = CaptureBytes {
                    frame: data.metadata.frame,
                    png,
                    width: data.metadata.width,
                    height: data.metadata.height,
                };
                bytes.validate()?;
                Ok(bytes)
            }
        }
    }
    /// Relays a screenshot to the `preview_main` renderer, checks the PNG, and writes the file.
    pub(super) async fn screenshot(
        &self,
        owner: &str,
        params: CameraScreenshotParams,
    ) -> Result<CameraScreenshotResult, AppError> {
        params.validate()?;
        let target = {
            let inner = lock(&self.inner);
            let target = inner
                .renderers
                .get("preview_main")
                .cloned()
                .ok_or_else(|| err(ErrorCode::Unavailable, "Preview renderer disconnected"))?;
            let scene = &inner
                .latest
                .as_ref()
                .ok_or_else(|| err(ErrorCode::Unavailable, "Scene unavailable"))?
                .scene;
            if scene.revision != params.expected_revision {
                return Err(err(ErrorCode::Conflict, "Stale revision"));
            }
            if !scene.entities.iter().any(
                |entity| matches!(entity, SceneEntity::Camera { id, .. } if *id == params.camera_id),
            ) {
                return Err(AppError {
                    code: ErrorCode::NotFound,
                    message: "Camera not found".into(),
                    ids: vec![params.camera_id.clone()],
                });
            }
            target
        };
        {
            // One limit for the whole host: a screenshot costs a full render in the Scene window.
            let mut last = lock(&self.last_screenshot);
            let now = Instant::now();
            if last.is_some_and(|at| now.duration_since(at) < Duration::from_secs(1)) {
                return Err(err(ErrorCode::RateLimited, "Screenshot rate limit"));
            }
            *last = Some(now);
        }
        let camera_id = params.camera_id.clone();
        let revision = params.expected_revision;
        let timeout = *lock(&self.screenshot_timeout);
        let result = self
            .relay_within(owner, target, "cameraScreenshot", timeout, |request_id| {
                json!(WireMessage::ScreenshotRequest { request_id, params })
            })
            .await?;
        let data = match serde_json::from_value::<Reply<ScreenshotReplyData>>(result)
            .map_err(|_| invalid("Invalid screenshot reply"))?
        {
            Reply::Failure(f) => return Err(f.error),
            Reply::Success(s) => s.data,
        };
        if data.session_id != self.session
            || data.revision != revision
            || data.camera_id != camera_id
        {
            return Err(err(
                ErrorCode::StaleFrame,
                "Screenshot does not match request",
            ));
        }
        let png = STANDARD
            .decode(data.png_base64)
            .map_err(|_| invalid("Invalid screenshot PNG encoding"))?;
        crate::screenshots::check_png(&png)?;
        let stem = crate::screenshots::file_stem((lock(&self.screenshot_clock))(), &camera_id);
        let folder = self.screenshot_folder.clone();
        let (file_name, png) = tokio::task::spawn_blocking(move || {
            crate::screenshots::write_new(&folder, &stem, &png).map(|name| (name, png))
        })
        .await
        .map_err(|_| err(ErrorCode::Unavailable, "Cannot write screenshot"))??;
        Ok(CameraScreenshotResult {
            file_name,
            width: crate::screenshots::WIDTH,
            height: crate::screenshots::HEIGHT,
            bytes: png.len() as u64,
            sha256: crate::screenshots::sha256_hex(&png),
            camera_id,
            revision,
        })
    }
}
#[cfg(test)]
mod local_address_tests {
    use super::local_addresses;
    #[test]
    fn local_addresses_keep_up_ipv4_non_loopback_non_link_local_in_numeric_order() {
        let ip = |s: &str| s.parse().unwrap();
        let mut interfaces = vec![
            (ip("127.0.0.1"), true),
            (ip("169.254.10.2"), true),
            (ip("192.168.1.9"), false),
            (ip("fe80::1"), true),
            (ip("2001:db8::1"), true),
            (ip("192.168.1.20"), true),
            (ip("10.0.0.2"), true),
            (ip("192.168.1.3"), true),
            (ip("10.0.0.2"), true),
        ];
        assert_eq!(
            local_addresses(interfaces.clone()),
            vec!["10.0.0.2", "192.168.1.3", "192.168.1.20"]
        );
        interfaces.extend((1..=9).map(|n| (ip(&format!("172.16.0.{n}")), true)));
        let limited = local_addresses(interfaces);
        assert_eq!(limited.len(), 8);
        assert_eq!(limited[0], "10.0.0.2");
        assert_eq!(limited[7], "172.16.0.7");
    }
}
