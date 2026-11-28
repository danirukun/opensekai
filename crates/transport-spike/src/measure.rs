use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::metrics::{summarize, Sample};
use super::playout::deliver_unordered;
use super::pose::seal;
use super::signal::Http;
use super::str0m_client::Session;

pub async fn run(base: &str, hz: u32, seconds: u64) -> Value {
    let http = Http::new(base);
    let before = http.runtime_ms().await.ok();
    let started = Instant::now();
    let cpu_before = cpu_ticks();
    let report = match session(&http, hz, seconds).await {
        Ok(value) => value,
        Err(err) => json!({
            "place": "loopback",
            "adapter": "ex_webrtc",
            "hz": hz,
            "iceSuccess": false,
            "setupMs": null,
            "lossPct": null,
            "jitterMs": null,
            "p95Ms": null,
            "clientCpuPct": null,
            "relayErlangRuntimePct": null,
            "lostPacketHeldNext": null,
            "error": err
        }),
    };
    let cpu = cpu_percent(cpu_before, started.elapsed());
    let relay = match (before, http.runtime_ms().await.ok()) {
        (Some(start), Some(end)) => {
            let wall = started.elapsed().as_millis() as f64;
            if wall > 0.0 {
                Some((end.saturating_sub(start) as f64) * 100.0 / wall)
            } else {
                None
            }
        }
        _ => None,
    };
    let mut report = report;
    if let Some(object) = report.as_object_mut() {
        object.insert("clientCpuPct".to_string(), json!(cpu));
        object.insert("relayErlangRuntimePct".to_string(), json!(relay));
    }
    report
}

async fn session(http: &Http, hz: u32, seconds: u64) -> Result<Value, String> {
    let room = http.create("host").await?;
    let mut guests = Vec::new();
    for index in 1..4 {
        let knocked = http.knock(&room.room_id, &format!("guest-{index}")).await?;
        let id = knocked
            .get("participantId")
            .and_then(|v| v.as_str())
            .ok_or("participantId")?
            .to_string();
        if knocked.get("participantSecret").is_some() {
            return Err("pending guest received a secret".to_string());
        }
        let secret = http
            .approve(&room.room_id, &room.host_secret, &id)
            .await?;
        guests.push((id, secret));
    }
    let mut peers = vec![(0u32, room.participant_secret.clone())];
    for (index, (_id, secret)) in guests.into_iter().enumerate() {
        peers.push(((index as u32) + 1, secret));
    }
    let key = [9u8; 32];
    let mut opened = 0u32;
    let mut setup_ms = Vec::new();
    let mut samples = Vec::new();
    let mut sent = 0u64;
    let mut saw_seq_3 = false;
    let interval = Duration::from_micros(1_000_000 / hz as u64);
    let frames = (hz as u64) * seconds;
    for (sender, secret) in peers {
        let offer = Session::offer()?;
        let mid = offer
            .sdp
            .lines()
            .find_map(|line| line.strip_prefix("a=mid:"))
            .unwrap_or("0");
        let signal = http
            .signal(
                &room.room_id,
                &secret,
                &offer.sdp,
                &[serde_json::json!({
                    "candidate": offer.candidate,
                    "sdpMid": mid,
                    "sdpMLineIndex": 0
                })],
            )
            .await?;
        let answer = signal
            .get("description")
            .and_then(|v| v.get("sdp"))
            .and_then(|v| v.as_str())
            .ok_or("answer sdp")?
            .to_string();
        let remote: Vec<String> = signal
            .get("candidates")
            .and_then(|v| v.as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|item| item.get("candidate").and_then(|v| v.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let setup = Instant::now();
        let mut session = Session::accept(offer, &answer, &remote)?;
        let open = session.wait_open(Duration::from_secs(8))?;
        if open {
            opened += 1;
            setup_ms.push(setup.elapsed().as_millis() as u64);
        }
        let send_until = Instant::now() + Duration::from_secs(seconds);
        let mut next = Instant::now();
        let mut seq = 1u32;
        while Instant::now() < send_until && seq as u64 <= frames {
            if Instant::now() >= next {
                let skip = sender == 1 && seq == 2;
                if !skip {
                    let send_us = now_us();
                    let mut body = seal(&key, sender, seq, send_us);
                    let mut packet = Vec::with_capacity(8 + body.len());
                    packet.extend_from_slice(&sender.to_le_bytes());
                    packet.extend_from_slice(&seq.to_le_bytes());
                    packet.append(&mut body);
                    let _ = session.send(&packet)?;
                    sent += 1;
                }
                let _ = deliver_unordered(seq);
                seq += 1;
                next += interval;
            }
            session.pump(Instant::now() + Duration::from_millis(5))?;
        }
        for packet in session.inbound() {
            if packet.len() < 8 {
                continue;
            }
            let from = u32::from_le_bytes(packet[0..4].try_into().unwrap());
            let seq = u32::from_le_bytes(packet[4..8].try_into().unwrap());
            if let Some((opened_seq, send_us)) = super::pose::open(&key, from, seq, &packet[8..]) {
                if from == 1 && opened_seq == 3 {
                    saw_seq_3 = true;
                }
                samples.push(Sample {
                    send_us,
                    recv_us: now_us(),
                });
            }
        }
    }
    let summary = summarize(sent, &samples);
    let ice = opened == 4;
    Ok(json!({
        "place": "loopback",
        "adapter": "ex_webrtc",
        "hz": hz,
        "participants": 4,
        "iceSuccess": if opened == 0 { false } else { ice },
        "setupMs": setup_ms.iter().max().copied(),
        "lossPct": summary.loss_pct,
        "jitterMs": summary.jitter_ms,
        "p95Ms": summary.p95_ms,
        "lostPacketHeldNext": if saw_seq_3 { Some(false) } else { None },
        "opened": opened
    }))
}

fn now_us() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

fn cpu_ticks() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/self/stat").ok()?;
    let rest = text.rsplit_once(')')?.1;
    let mut fields = rest.split_whitespace();
    let utime: u64 = fields.nth(11)?.parse().ok()?;
    let stime: u64 = fields.next()?.parse().ok()?;
    Some(utime + stime)
}

fn cpu_percent(before: Option<u64>, elapsed: Duration) -> Option<f64> {
    let start = before?;
    let end = cpu_ticks()?;
    let ticks = end.saturating_sub(start) as f64;
    let hz = 100.0;
    let wall = elapsed.as_secs_f64();
    if wall == 0.0 {
        None
    } else {
        Some(ticks / hz / wall * 100.0)
    }
}
