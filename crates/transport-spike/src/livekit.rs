pub fn linked() -> bool {
    false
}

#[allow(dead_code)]
pub async fn publish_lossy(_url: &str, _token: &str, _payload: Vec<u8>) -> Result<(), String> {
    Err("livekit crate is not linked: livekit 0.12.1 needs zip ^9.0.4 and libwebrtc, and the workspace pins zip 9.0.3".to_string())
}
