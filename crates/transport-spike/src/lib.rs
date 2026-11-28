mod livekit;
mod measure;
mod metrics;
mod playout;
mod pose;
mod signal;
mod str0m_client;

pub async fn run() -> i32 {
    let mut report = serde_json::json!({
        "place": "loopback",
        "adapter": "ex_webrtc",
        "fly": null,
        "macos": null,
        "windows": null,
        "livekitLinked": livekit::linked(),
        "livekit": null,
        "notes": [
            "Fly, macOS, and Windows were not measured in this run.",
            "WebTransport and Cloudflare Realtime were not built."
        ]
    });
    if let Ok(base) = std::env::var("RELAY_URL") {
        let hz: u32 = std::env::var("SPIKE_HZ").ok().and_then(|v| v.parse().ok()).unwrap_or(60);
        let seconds: u64 = std::env::var("SPIKE_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2);
        let measured = measure::run(&base, hz, seconds).await;
        if let Some(object) = report.as_object_mut() {
            if let Some(measured) = measured.as_object() {
                for (key, value) in measured {
                    object.insert(key.clone(), value.clone());
                }
            }
        }
    } else {
        if let Some(object) = report.as_object_mut() {
            object.insert("iceSuccess".to_string(), serde_json::Value::Null);
            object.insert(
                "notes".to_string(),
                serde_json::json!([
                    "RELAY_URL is unset, so the loopback session did not run.",
                    "Fly, macOS, and Windows were not measured in this run."
                ]),
            );
        }
    }
    println!("{}", serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".to_string()));
    0
}
