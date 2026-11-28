pub fn linked() -> bool {
    cfg!(feature = "livekit")
}

#[cfg(feature = "livekit")]
pub async fn compare(
    http: &super::signal::Http,
    room_id: &str,
    peers: &[(u32, String)],
    hz: u32,
    seconds: u64,
    key: &[u8; 32],
) -> serde_json::Value {
    use std::time::{Duration, Instant};

    use livekit::prelude::*;

    use super::metrics::{summarize, Sample};
    use super::pose::{open, seal};

    let mut rooms = Vec::new();
    let setup = Instant::now();
    for (sender, secret) in peers {
        let (url, token) = match http.livekit_token(room_id, secret).await {
            Ok(pair) => pair,
            Err(err) => return fail(&err),
        };
        match Room::connect(&url, &token, RoomOptions::default()).await {
            Ok(pair) => rooms.push((*sender, pair)),
            Err(err) => return fail(&err.to_string()),
        }
    }
    let setup_ms = setup.elapsed().as_millis() as u64;
    let frames = (hz as u64) * seconds;
    let interval = Duration::from_micros(1_000_000 / hz as u64);
    let end = Instant::now() + Duration::from_secs(seconds);
    let mut next = vec![Instant::now(); rooms.len()];
    let mut seq = vec![1u32; rooms.len()];
    let mut sent = 0u64;
    let mut inbound: Vec<(Vec<u8>, u64)> = Vec::new();
    while Instant::now() < end {
        for (index, (sender, (room, events))) in rooms.iter_mut().enumerate() {
            drain_events(events, &mut inbound);
            if Instant::now() >= next[index] && seq[index] as u64 <= frames {
                let skip = *sender == 1 && seq[index] == 2;
                if !skip {
                    let send_us = now_us();
                    let mut body = seal(key, *sender, seq[index], send_us);
                    let mut packet = Vec::with_capacity(8 + body.len());
                    packet.extend_from_slice(&sender.to_le_bytes());
                    packet.extend_from_slice(&seq[index].to_le_bytes());
                    packet.append(&mut body);
                    let participant = room.local_participant();
                    let published = participant
                        .publish_data(DataPacket {
                            payload: packet,
                            reliable: false,
                            ..Default::default()
                        })
                        .await;
                    if published.is_ok() {
                        sent += 1;
                    }
                }
                seq[index] += 1;
                next[index] += interval;
            }
        }
        tokio::task::yield_now().await;
    }
    for (_sender, (_room, events)) in rooms.iter_mut() {
        drain_events(events, &mut inbound);
    }
    let mut samples = Vec::new();
    let mut saw_seq_3 = false;
    for (packet, recv_us) in &inbound {
        if packet.len() < 8 {
            continue;
        }
        let from = u32::from_le_bytes(packet[0..4].try_into().unwrap_or([0; 4]));
        let packet_seq = u32::from_le_bytes(packet[4..8].try_into().unwrap_or([0; 4]));
        if let Some((opened_seq, send_us)) = open(key, from, packet_seq, &packet[8..]) {
            if from == 1 && opened_seq == 3 {
                saw_seq_3 = true;
            }
            samples.push(Sample {
                send_us,
                recv_us: *recv_us,
            });
        }
    }
    let summary = summarize(sent.saturating_mul((peers.len() as u64).saturating_sub(1)), &samples);
    serde_json::json!({
        "place": "loopback",
        "adapter": "livekit",
        "iceSuccess": true,
        "setupMs": setup_ms,
        "lossPct": summary.loss_pct,
        "jitterMs": summary.jitter_ms,
        "p95Ms": summary.p95_ms,
        "lostPacketHeldNext": if saw_seq_3 { Some(false) } else { None },
        "participants": peers.len(),
        "hz": hz
    })
}

#[cfg(feature = "livekit")]
fn drain_events(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<livekit::RoomEvent>,
    inbound: &mut Vec<(Vec<u8>, u64)>,
) {
    use livekit::RoomEvent;
    while let Ok(event) = events.try_recv() {
        if let RoomEvent::DataReceived { payload, .. } = event {
            inbound.push((payload.to_vec(), now_us()));
        }
    }
}

#[cfg(feature = "livekit")]
fn now_us() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

#[cfg(feature = "livekit")]
fn fail(err: &str) -> serde_json::Value {
    serde_json::json!({
        "place": "loopback",
        "adapter": "livekit",
        "iceSuccess": false,
        "error": err,
        "lossPct": null,
        "jitterMs": null,
        "p95Ms": null,
        "lostPacketHeldNext": null
    })
}

#[cfg(not(feature = "livekit"))]
pub async fn compare(
    _http: &super::signal::Http,
    _room_id: &str,
    _peers: &[(u32, String)],
    _hz: u32,
    _seconds: u64,
    _key: &[u8; 32],
) -> serde_json::Value {
    serde_json::json!({
        "iceSuccess": null,
        "error": "livekit feature is not linked"
    })
}
