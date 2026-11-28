use serde_json::{json, Value};

pub struct RoomCreds {
    pub room_id: String,
    pub host_secret: String,
    #[allow(dead_code)]
    pub participant_id: String,
    pub participant_secret: String,
}

pub struct Http {
    base: String,
    client: reqwest::Client,
}

impl Http {
    pub fn new(base: &str) -> Self {
        Self {
            base: base.trim_end_matches('/').to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("http client"),
        }
    }

    pub async fn create(&self, name: &str) -> Result<RoomCreds, String> {
        let body = self
            .post("/api/rooms", json!({"name": name}))
            .await?;
        Ok(RoomCreds {
            room_id: text(&body, "roomId")?,
            host_secret: text(&body, "hostSecret")?,
            participant_id: text(&body, "participantId")?,
            participant_secret: text(&body, "participantSecret")?,
        })
    }

    pub async fn knock(&self, room_id: &str, name: &str) -> Result<Value, String> {
        self.post(&format!("/api/rooms/{room_id}/knock"), json!({"name": name}))
            .await
    }

    pub async fn approve(
        &self,
        room_id: &str,
        host_secret: &str,
        participant_id: &str,
    ) -> Result<String, String> {
        let body = self
            .post(
                &format!("/api/rooms/{room_id}/approve"),
                json!({"hostSecret": host_secret, "participantId": participant_id}),
            )
            .await?;
        text(&body, "participantSecret")
    }

    pub async fn signal(
        &self,
        room_id: &str,
        secret: &str,
        sdp: &str,
        candidates: &[Value],
    ) -> Result<Value, String> {
        self.post(
            &format!("/api/rooms/{room_id}/signal"),
            json!({
                "participantSecret": secret,
                "description": {"type": "offer", "sdp": sdp},
                "candidates": candidates
            }),
        )
        .await
    }

    #[allow(dead_code)]
    pub async fn livekit_token(&self, room_id: &str, secret: &str) -> Result<(String, String), String> {
        let body = self
            .post(
                &format!("/api/rooms/{room_id}/livekit"),
                json!({"participantSecret": secret}),
            )
            .await?;
        Ok((text(&body, "url")?, text(&body, "token")?))
    }

    pub async fn runtime_ms(&self) -> Result<u64, String> {
        let body = self.get("/api/runtime").await?;
        body.get("erlangRuntimeMs")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| "runtime missing".to_string())
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        let response = self
            .client
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .map_err(|err| err.to_string())?;
        let status = response.status();
        let text = response.text().await.map_err(|err| err.to_string())?;
        if !status.is_success() {
            return Err(format!("{status} {text}"));
        }
        serde_json::from_str(&text).map_err(|err| err.to_string())
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .client
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .map_err(|err| err.to_string())?;
        let status = response.status();
        let text = response.text().await.map_err(|err| err.to_string())?;
        if !status.is_success() {
            return Err(format!("{status} {text}"));
        }
        serde_json::from_str(&text).map_err(|err| err.to_string())
    }
}

fn text(body: &Value, key: &str) -> Result<String, String> {
    body.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("{key} missing"))
}
