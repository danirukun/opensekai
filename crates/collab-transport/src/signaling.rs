use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::SendOutcome;

const DEFAULT_SOCKET_PATH: &str = "/socket/websocket";
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const EVENT_CAPACITY: usize = 256;
const BINARY_CAPACITY: usize = 1024;
const KIND_PUSH: u8 = 0;
const KIND_REPLY: u8 = 1;
const KIND_BROADCAST: u8 = 2;

#[derive(Debug, Error)]
pub enum SignalingError {
    #[error("invalid relay url: {0}")]
    BadUrl(String),
    #[error("websocket error: {0}")]
    WebSocket(String),
    #[error("room join rejected: {0}")]
    JoinRejected(Value),
    #[error("relay rejected request: {0}")]
    Rejected(String),
    #[error("request timed out")]
    Timeout,
    #[error("signalling connection closed")]
    Closed,
    #[error("malformed phoenix frame: {0}")]
    BadFrame(String),
    #[error("phoenix field {0} longer than 255 bytes")]
    FieldTooLong(&'static str),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub status: String,
    pub response: Value,
}

/// One decoded server frame. A text reply with ref `reference` answers a request of the client.
#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Reply {
        reference: String,
        reply: Reply,
    },
    Event {
        topic: String,
        event: String,
        payload: Value,
    },
    BinaryEvent {
        topic: String,
        event: String,
        payload: Vec<u8>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerEvent {
    pub event: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryEvent {
    pub event: String,
    pub payload: Vec<u8>,
}

pub fn encode_text(
    join_ref: Option<&str>,
    reference: Option<&str>,
    topic: &str,
    event: &str,
    payload: &Value,
) -> String {
    json!([join_ref, reference, topic, event, payload]).to_string()
}

fn field_len(field: &str, name: &'static str) -> Result<u8, SignalingError> {
    u8::try_from(field.len()).map_err(|_| SignalingError::FieldTooLong(name))
}

/// Client push with a binary payload: `[0, join_ref_len, ref_len, topic_len, event_len, join_ref, ref, topic, event, payload]`.
pub fn encode_binary_push(
    join_ref: &str,
    reference: &str,
    topic: &str,
    event: &str,
    payload: &[u8],
) -> Result<Vec<u8>, SignalingError> {
    let lengths = [
        field_len(join_ref, "join_ref")?,
        field_len(reference, "ref")?,
        field_len(topic, "topic")?,
        field_len(event, "event")?,
    ];
    let mut out = Vec::with_capacity(
        5 + join_ref.len() + reference.len() + topic.len() + event.len() + payload.len(),
    );
    out.push(KIND_PUSH);
    out.extend_from_slice(&lengths);
    for field in [join_ref, reference, topic, event] {
        out.extend_from_slice(field.as_bytes());
    }
    out.extend_from_slice(payload);
    Ok(out)
}

pub fn decode_text(text: &str) -> Result<Incoming, SignalingError> {
    let bad = |reason: &str| SignalingError::BadFrame(reason.to_owned());
    let Value::Array(fields) =
        serde_json::from_str(text).map_err(|err| SignalingError::BadFrame(err.to_string()))?
    else {
        return Err(bad("expected a JSON array"));
    };
    let [_join_ref, reference, topic, event, payload] =
        <[Value; 5]>::try_from(fields).map_err(|_| bad("expected 5 fields"))?;
    let topic = topic
        .as_str()
        .ok_or_else(|| bad("topic is not a string"))?
        .to_owned();
    let event = event
        .as_str()
        .ok_or_else(|| bad("event is not a string"))?
        .to_owned();
    if event != "phx_reply" {
        return Ok(Incoming::Event {
            topic,
            event,
            payload,
        });
    }
    let reference = reference
        .as_str()
        .ok_or_else(|| bad("reply without ref"))?
        .to_owned();
    let status = payload
        .get("status")
        .and_then(Value::as_str)
        .ok_or_else(|| bad("reply without status"))?
        .to_owned();
    let response = payload.get("response").cloned().unwrap_or(Value::Null);
    Ok(Incoming::Reply {
        reference,
        reply: Reply { status, response },
    })
}

/// Server push (`kind 0`: `[0, join_ref_len, topic_len, event_len, ...]`) and
/// broadcast (`kind 2`: `[2, topic_len, event_len, ...]`) frames with a binary payload.
pub fn decode_binary(bytes: &[u8]) -> Result<Incoming, SignalingError> {
    let truncated = || SignalingError::BadFrame("truncated binary frame".to_owned());
    let (&kind, rest) = bytes.split_first().ok_or_else(truncated)?;
    let (skipped, topic_len, event_len, rest) = match (kind, rest) {
        (KIND_PUSH, [join_ref_len, topic_len, event_len, rest @ ..]) => {
            (usize::from(*join_ref_len), *topic_len, *event_len, rest)
        }
        (KIND_BROADCAST, [topic_len, event_len, rest @ ..]) => (0, *topic_len, *event_len, rest),
        (KIND_REPLY, _) => {
            return Err(SignalingError::BadFrame(
                "binary replies are not supported".to_owned(),
            ))
        }
        (KIND_PUSH | KIND_BROADCAST, _) => return Err(truncated()),
        (other, _) => {
            return Err(SignalingError::BadFrame(format!(
                "unknown binary kind {other}"
            )))
        }
    };
    let rest = rest.get(skipped..).ok_or_else(truncated)?;
    let (topic, rest) = rest
        .split_at_checked(usize::from(topic_len))
        .ok_or_else(truncated)?;
    let (event, payload) = rest
        .split_at_checked(usize::from(event_len))
        .ok_or_else(truncated)?;
    let utf8 = |field: &[u8]| {
        std::str::from_utf8(field)
            .map(str::to_owned)
            .map_err(|_| SignalingError::BadFrame("non-UTF-8 field".to_owned()))
    };
    Ok(Incoming::BinaryEvent {
        topic: utf8(topic)?,
        event: utf8(event)?,
        payload: payload.to_vec(),
    })
}

pub fn socket_url(relay_url: &str) -> Result<url::Url, SignalingError> {
    let mut url =
        url::Url::parse(relay_url).map_err(|err| SignalingError::BadUrl(err.to_string()))?;
    if !matches!(url.scheme(), "ws" | "wss") {
        return Err(SignalingError::BadUrl(format!(
            "unsupported scheme {}",
            url.scheme()
        )));
    }
    if url.path().is_empty() || url.path() == "/" {
        url.set_path(DEFAULT_SOCKET_PATH);
    }
    if !url.query_pairs().any(|(key, _)| key == "vsn") {
        url.query_pairs_mut().append_pair("vsn", "2.0.0");
    }
    Ok(url)
}

/// `tokio-tungstenite` builds `rustls` without a crypto provider, so `wss://` needs one installed.
fn install_crypto_provider() {
    static INSTALL: std::sync::Once = std::sync::Once::new();
    INSTALL.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Reply>>>>;

struct Inner {
    url: url::Url,
    topic: String,
    join_ref: String,
    next_ref: AtomicU64,
    control_tx: mpsc::UnboundedSender<Message>,
    pose_tx: mpsc::Sender<Message>,
    pending: Pending,
    events_tx: broadcast::Sender<ServerEvent>,
    binary_tx: broadcast::Sender<BinaryEvent>,
    closed_rx: watch::Receiver<bool>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl Drop for Inner {
    fn drop(&mut self) {
        for task in self
            .tasks
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
        {
            task.abort();
        }
    }
}

/// Phoenix Channels V2 client for one `room:<room_id>` topic. Cloning shares the connection.
#[derive(Clone)]
pub struct SignalingClient {
    inner: Arc<Inner>,
}

impl SignalingClient {
    /// Opens the socket at `relay_url` (the path defaults to `/socket/websocket`, `vsn=2.0.0` is added)
    /// and joins `room:<room_id>`.
    pub async fn connect(relay_url: &str, room_id: &str) -> Result<Self, SignalingError> {
        let url = socket_url(relay_url)?;
        install_crypto_provider();
        let (socket, _) = tokio_tungstenite::connect_async(url.as_str())
            .await
            .map_err(|err| SignalingError::WebSocket(err.to_string()))?;
        let (mut sink, mut stream) = socket.split();

        let topic = format!("room:{room_id}");
        let join_ref = "1".to_owned();
        let pending: Pending = Arc::default();
        let (control_tx, mut control_rx) = mpsc::unbounded_channel::<Message>();
        let (pose_tx, mut pose_rx) = mpsc::channel::<Message>(1);
        let (events_tx, _) = broadcast::channel(EVENT_CAPACITY);
        let (binary_tx, _) = broadcast::channel(BINARY_CAPACITY);
        let (closed_tx, closed_rx) = watch::channel(false);

        let writer = tokio::spawn(async move {
            let mut heartbeat = tokio::time::interval_at(
                tokio::time::Instant::now() + HEARTBEAT_INTERVAL,
                HEARTBEAT_INTERVAL,
            );
            let mut heartbeat_ref = 0u64;
            loop {
                let message = tokio::select! {
                    Some(message) = control_rx.recv() => message,
                    Some(message) = pose_rx.recv() => message,
                    _ = heartbeat.tick() => {
                        heartbeat_ref += 1;
                        let reference = format!("hb-{heartbeat_ref}");
                        Message::text(encode_text(None, Some(&reference), "phoenix", "heartbeat", &json!({})))
                    }
                    else => break,
                };
                let closing = matches!(message, Message::Close(_));
                if sink.send(message).await.is_err() || closing {
                    break;
                }
            }
            let _ = sink.close().await;
        });

        let reader = {
            let topic = topic.clone();
            let pending = Arc::clone(&pending);
            let events_tx = events_tx.clone();
            let binary_tx = binary_tx.clone();
            tokio::spawn(async move {
                while let Some(Ok(message)) = stream.next().await {
                    let incoming = match &message {
                        Message::Text(text) => decode_text(text.as_str()),
                        Message::Binary(bytes) => decode_binary(bytes),
                        Message::Close(_) => break,
                        _ => continue,
                    };
                    match incoming {
                        Ok(Incoming::Reply { reference, reply }) => {
                            let waiter = pending
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .remove(&reference);
                            if let Some(waiter) = waiter {
                                let _ = waiter.send(reply);
                            }
                        }
                        Ok(Incoming::Event {
                            topic: event_topic,
                            event,
                            payload,
                        }) if event_topic == topic => {
                            let _ = events_tx.send(ServerEvent { event, payload });
                        }
                        Ok(Incoming::BinaryEvent {
                            topic: event_topic,
                            event,
                            payload,
                        }) if event_topic == topic => {
                            let _ = binary_tx.send(BinaryEvent { event, payload });
                        }
                        Ok(_) | Err(_) => {}
                    }
                }
                pending.lock().unwrap_or_else(|e| e.into_inner()).clear();
                let _ = closed_tx.send(true);
            })
        };

        let client = Self {
            inner: Arc::new(Inner {
                url,
                topic,
                join_ref,
                next_ref: AtomicU64::new(2),
                control_tx,
                pose_tx,
                pending,
                events_tx,
                binary_tx,
                closed_rx,
                tasks: Mutex::new(vec![writer, reader]),
            }),
        };

        let join = client
            .send_request("phx_join", json!({}), "1".to_owned())
            .await?;
        if join.status != "ok" {
            return Err(SignalingError::JoinRejected(join.response));
        }
        Ok(client)
    }

    /// The socket URL after the default path and `vsn` were added.
    pub fn relay_url(&self) -> &url::Url {
        &self.inner.url
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<ServerEvent> {
        self.inner.events_tx.subscribe()
    }

    pub fn subscribe_binary(&self) -> broadcast::Receiver<BinaryEvent> {
        self.inner.binary_tx.subscribe()
    }

    pub fn is_closed(&self) -> bool {
        *self.inner.closed_rx.borrow()
    }

    pub async fn wait_closed(&self) {
        let mut closed = self.inner.closed_rx.clone();
        let _ = closed.wait_for(|closed| *closed).await;
    }

    pub async fn request(&self, event: &str, payload: Value) -> Result<Reply, SignalingError> {
        self.send_request(event, payload, self.next_ref()).await
    }

    /// Returns the `response` map of an `ok` reply; an `error` reply becomes `SignalingError::Rejected(reason)`.
    pub async fn request_ok(&self, event: &str, payload: Value) -> Result<Value, SignalingError> {
        let reply = self.request(event, payload).await?;
        if reply.status == "ok" {
            Ok(reply.response)
        } else {
            let reason = reply
                .response
                .get("reason")
                .and_then(Value::as_str)
                .map_or_else(|| reply.response.to_string(), str::to_owned);
            Err(SignalingError::Rejected(reason))
        }
    }

    pub async fn create(
        &self,
        host_secret: &str,
        transport_kind: &str,
        hz: u32,
    ) -> Result<Value, SignalingError> {
        self.request_ok(
            "create",
            json!({"host_secret": host_secret, "transport_kind": transport_kind, "hz": hz}),
        )
        .await
    }

    pub async fn reclaim(
        &self,
        host_secret: &str,
        transport_kind: &str,
        hz: u32,
    ) -> Result<Value, SignalingError> {
        self.request_ok(
            "reclaim",
            json!({"host_secret": host_secret, "transport_kind": transport_kind, "hz": hz}),
        )
        .await
    }

    pub async fn knock(&self, display_name: &str) -> Result<Value, SignalingError> {
        self.request_ok("knock", json!({"display_name": display_name}))
            .await
    }

    pub async fn approve(&self, knock_id: &str) -> Result<Value, SignalingError> {
        self.request_ok("approve", json!({"knock_id": knock_id}))
            .await
    }

    pub async fn reject(&self, knock_id: &str) -> Result<Value, SignalingError> {
        self.request_ok("reject", json!({"knock_id": knock_id}))
            .await
    }

    pub async fn kick(&self, slot: u8) -> Result<Value, SignalingError> {
        self.request_ok("kick", json!({"slot": slot})).await
    }

    pub async fn set_hz(&self, hz: u32) -> Result<Value, SignalingError> {
        self.request_ok("set_hz", json!({"hz": hz})).await
    }

    pub async fn stats(&self) -> Result<Value, SignalingError> {
        self.request_ok("stats", json!({})).await
    }

    pub async fn send_signal(&self, signal: Value) -> Result<Value, SignalingError> {
        self.request_ok("signal", signal).await
    }

    /// Pushes a binary `event` without waiting for a reply. At most one frame waits for the socket
    /// writer; a frame that finds the slot full is dropped.
    pub fn push_binary(&self, event: &str, payload: &[u8]) -> SendOutcome {
        let encoded = encode_binary_push(
            &self.inner.join_ref,
            &self.next_ref(),
            &self.inner.topic,
            event,
            payload,
        );
        let Ok(encoded) = encoded else {
            return SendOutcome::Disconnected;
        };
        match self.inner.pose_tx.try_send(Message::binary(encoded)) {
            Ok(()) => SendOutcome::Sent,
            Err(mpsc::error::TrySendError::Full(_)) => SendOutcome::DroppedBackpressure,
            Err(mpsc::error::TrySendError::Closed(_)) => SendOutcome::Disconnected,
        }
    }

    pub async fn close(&self) {
        let _ = self.inner.control_tx.send(Message::Close(None));
        let _ = tokio::time::timeout(Duration::from_secs(1), self.wait_closed()).await;
        for task in self
            .inner
            .tasks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
        {
            task.abort();
        }
    }

    fn next_ref(&self) -> String {
        self.inner
            .next_ref
            .fetch_add(1, Ordering::Relaxed)
            .to_string()
    }

    async fn send_request(
        &self,
        event: &str,
        payload: Value,
        reference: String,
    ) -> Result<Reply, SignalingError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(reference.clone(), reply_tx);
        let text = encode_text(
            Some(&self.inner.join_ref),
            Some(&reference),
            &self.inner.topic,
            event,
            &payload,
        );
        if self.inner.control_tx.send(Message::text(text)).is_err() {
            return Err(SignalingError::Closed);
        }
        let outcome = tokio::time::timeout(REQUEST_TIMEOUT, reply_rx).await;
        match outcome {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(_)) => Err(SignalingError::Closed),
            Err(_) => {
                self.inner
                    .pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&reference);
                Err(SignalingError::Timeout)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_binary_push_matches_phoenix_v2_layout() {
        let bytes = encode_binary_push("1", "7", "room:abc", "pose", &[0xDE, 0xAD]).unwrap();
        let mut expected = vec![0u8, 1, 1, 8, 4];
        expected.extend_from_slice(b"1");
        expected.extend_from_slice(b"7");
        expected.extend_from_slice(b"room:abc");
        expected.extend_from_slice(b"pose");
        expected.extend_from_slice(&[0xDE, 0xAD]);
        assert_eq!(bytes, expected);
    }

    #[test]
    fn binary_push_rejects_fields_over_255_bytes() {
        let topic = "t".repeat(256);
        assert!(matches!(
            encode_binary_push("1", "2", &topic, "pose", &[]),
            Err(SignalingError::FieldTooLong("topic"))
        ));
    }

    #[test]
    fn server_binary_push_decodes_with_three_length_header() {
        let envelope = vec![2u8, 9, 9, 9];
        let mut bytes = vec![0u8, 1, 8, 4];
        bytes.extend_from_slice(b"1room:abcpose");
        bytes.extend_from_slice(&envelope);
        assert_eq!(
            decode_binary(&bytes).unwrap(),
            Incoming::BinaryEvent {
                topic: "room:abc".into(),
                event: "pose".into(),
                payload: envelope
            }
        );
    }

    #[test]
    fn server_binary_broadcast_decodes_with_two_length_header() {
        let mut bytes = vec![2u8, 8, 4];
        bytes.extend_from_slice(b"room:abcpose");
        bytes.extend_from_slice(&[7, 8]);
        assert_eq!(
            decode_binary(&bytes).unwrap(),
            Incoming::BinaryEvent {
                topic: "room:abc".into(),
                event: "pose".into(),
                payload: vec![7, 8]
            }
        );
    }

    #[test]
    fn truncated_or_unknown_binary_frames_are_errors() {
        assert!(decode_binary(&[]).is_err());
        assert!(decode_binary(&[2, 8, 4, b'r']).is_err());
        assert!(decode_binary(&[1, 1, 1, 1, 2, b'1', b'1', b't', b'o', b'k']).is_err());
        assert!(decode_binary(&[9, 0, 0]).is_err());
    }

    #[test]
    fn text_push_encodes_as_five_element_array() {
        let text = encode_text(
            Some("1"),
            Some("5"),
            "room:abc",
            "knock",
            &json!({"display_name": "Mio"}),
        );
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            parsed,
            json!(["1", "5", "room:abc", "knock", {"display_name": "Mio"}])
        );
        let heartbeat: Value = serde_json::from_str(&encode_text(
            None,
            Some("hb"),
            "phoenix",
            "heartbeat",
            &json!({}),
        ))
        .unwrap();
        assert_eq!(heartbeat, json!([null, "hb", "phoenix", "heartbeat", {}]));
    }

    #[test]
    fn text_reply_decodes_status_and_response() {
        let text = r#"["1","5","room:abc","phx_reply",{"status":"ok","response":{"slot":0}}]"#;
        assert_eq!(
            decode_text(text).unwrap(),
            Incoming::Reply {
                reference: "5".into(),
                reply: Reply {
                    status: "ok".into(),
                    response: json!({"slot": 0})
                }
            }
        );
        let error = r#"["1","6","room:abc","phx_reply",{"status":"error","response":{"reason":"room_full"}}]"#;
        let Incoming::Reply { reply, .. } = decode_text(error).unwrap() else {
            panic!("expected reply");
        };
        assert_eq!(reply.status, "error");
        assert_eq!(reply.response["reason"], "room_full");
    }

    #[test]
    fn text_event_decodes_topic_event_and_payload() {
        let text = r#"["1",null,"room:abc","peer_joined",{"slot":1,"display_name":"Mio"}]"#;
        assert_eq!(
            decode_text(text).unwrap(),
            Incoming::Event {
                topic: "room:abc".into(),
                event: "peer_joined".into(),
                payload: json!({"slot": 1, "display_name": "Mio"})
            }
        );
        let broadcast = r#"[null,null,"room:abc","hz",{"hz":30}]"#;
        assert!(matches!(
            decode_text(broadcast).unwrap(),
            Incoming::Event { .. }
        ));
    }

    #[test]
    fn malformed_text_frames_are_errors() {
        assert!(decode_text("not json").is_err());
        assert!(decode_text(r#"["1","2","t"]"#).is_err());
        assert!(decode_text(r#"["1","2","t","phx_reply",{"status":1}]"#).is_err());
    }

    #[test]
    fn socket_url_adds_default_path_and_vsn() {
        assert_eq!(
            socket_url("ws://127.0.0.1:4002").unwrap().as_str(),
            "ws://127.0.0.1:4002/socket/websocket?vsn=2.0.0"
        );
        assert_eq!(
            socket_url("wss://relay.example/socket/websocket")
                .unwrap()
                .as_str(),
            "wss://relay.example/socket/websocket?vsn=2.0.0"
        );
        assert_eq!(
            socket_url("ws://h/socket/websocket?vsn=2.0.0")
                .unwrap()
                .as_str(),
            "ws://h/socket/websocket?vsn=2.0.0"
        );
        assert!(socket_url("http://h/socket").is_err());
    }
}
