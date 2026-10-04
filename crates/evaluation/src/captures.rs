use crate::error;
use opensekai_contracts::*;
use sha2::{Digest, Sha256};
use std::{collections::VecDeque, io::Cursor};
#[derive(Clone)]
struct Stored {
    record: CaptureRecord,
    png: Vec<u8>,
}
#[derive(Clone)]
pub struct CaptureStore {
    session: String,
    commit: String,
    fixture: String,
    records: VecDeque<Stored>,
    rates: VecDeque<(String, u64)>,
}
impl CaptureStore {
    pub fn new(session_id: String, app_commit: String, fixture_id: String) -> Self {
        Self {
            session: session_id,
            commit: app_commit,
            fixture: fixture_id,
            records: VecDeque::new(),
            rates: VecDeque::new(),
        }
    }
    #[expect(
        clippy::too_many_arguments,
        reason = "frozen evaluation interface injects both clocks"
    )]
    pub fn insert(
        &mut self,
        client_id: &str,
        params: CaptureParams,
        frame: FrameApplied,
        png: Vec<u8>,
        received_at_ms: u64,
        now_ms: u64,
        created_at_utc: String,
    ) -> Result<CaptureRecord, AppError> {
        params.validate()?;
        frame.validate()?;
        if frame.session_id != self.session || frame.output_id != params.output_id {
            return Err(error(
                ErrorCode::Conflict,
                "capture output or session mismatch",
            ));
        }
        if frame.revision != params.expected_revision {
            return Err(error(ErrorCode::Conflict, "capture revision mismatch"));
        }
        if received_at_ms > now_ms || now_ms.saturating_sub(received_at_ms) > 500 {
            return Err(error(ErrorCode::StaleFrame, "capture frame expired"));
        }
        let active_rates = self
            .rates
            .iter()
            .filter(|(_, at)| now_ms.saturating_sub(*at) < 1000);
        if active_rates.clone().any(|(client, _)| client == client_id) {
            return Err(error(ErrorCode::RateLimited, "capture rate exceeded"));
        }
        if active_rates.count() >= 1024 {
            return Err(error(ErrorCode::Busy, "capture client budget exceeded"));
        }
        if png.len() > 2 * 1024 * 1024 || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err(error(
                ErrorCode::InvalidInput,
                "invalid PNG size or signature",
            ));
        }
        let mut decoder = png::Decoder::new(Cursor::new(&png));
        decoder.set_limits(png::Limits {
            bytes: 32 * 1024 * 1024,
        });
        let mut reader = decoder
            .read_info()
            .map_err(|_| error(ErrorCode::InvalidInput, "invalid PNG header"))?;
        let width = reader.info().width;
        let height = reader.info().height;
        if width == 0 || width > 1920 || height == 0 || height > 1080 {
            return Err(error(ErrorCode::InvalidInput, "invalid PNG dimensions"));
        }
        let size = reader
            .output_buffer_size()
            .filter(|n| *n <= 1920 * 1080 * 8)
            .ok_or_else(|| error(ErrorCode::InvalidInput, "PNG decode exceeds budget"))?;
        reader
            .next_frame(&mut vec![0; size])
            .map_err(|_| error(ErrorCode::InvalidInput, "invalid PNG pixels"))?;
        reader
            .finish()
            .map_err(|_| error(ErrorCode::InvalidInput, "invalid PNG trailer"))?;
        let id = uuid::Uuid::new_v4().to_string();
        let record = CaptureRecord {
            id: id.clone(),
            output_id: frame.output_id,
            revision: frame.revision,
            tick: frame.tick,
            sequence: frame.sequence,
            backend: frame.backend,
            camera_id: frame.camera_id,
            width,
            height,
            mime_type: MimeType::ImagePng,
            bytes: png.len() as u64,
            sha256: Sha256::digest(&png)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
            resource_uri: format!("opensekai://evidence/{id}/capture.png"),
            created_at_utc,
        };
        record.validate()?;
        self.rates
            .retain(|(_, at)| now_ms.saturating_sub(*at) < 1000);
        self.rates.push_back((client_id.into(), now_ms));
        self.records.push_back(Stored {
            record: record.clone(),
            png,
        });
        if self.records.len() > 8 {
            self.records.pop_front();
        }
        Ok(record)
    }
    pub fn remove(&mut self, id: &str) {
        self.records.retain(|stored| stored.record.id != id);
    }
    pub fn read(&self, evidence_id: &str) -> Result<&[u8], AppError> {
        self.records
            .iter()
            .find(|s| s.record.id == evidence_id)
            .map(|s| s.png.as_slice())
            .ok_or_else(|| error(ErrorCode::NotFound, "capture not found"))
    }
    pub fn record(&self, id: &str) -> Result<&CaptureRecord, AppError> {
        self.records
            .iter()
            .find(|s| s.record.id == id)
            .map(|s| &s.record)
            .ok_or_else(|| error(ErrorCode::NotFound, "capture not found"))
    }
    pub fn manifest(&self, id: &str) -> Result<EvidenceManifest, AppError> {
        let r = self.record(id)?;
        if self.fixture != "smoke_v1" {
            return Err(error(ErrorCode::Unsupported, "unknown fixture"));
        }
        Ok(EvidenceManifest {
            id: r.id.clone(),
            kind: EvidenceKind::Capture,
            session_id: self.session.clone(),
            fixture_id: FixtureId::SmokeV1,
            app_commit: self.commit.clone(),
            resources: vec![EvidenceResource {
                uri: r.resource_uri.clone(),
                mime_type: "image/png".into(),
                sha256: r.sha256.clone(),
                bytes: r.bytes,
            }],
        })
    }
}
