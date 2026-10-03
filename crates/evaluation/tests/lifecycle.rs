use opensekai_contracts::*;
use opensekai_evaluation::{CaptureStore, RunManager};
fn output() -> FrameApplied {
    serde_json::from_str(include_str!(
        "../../../fixtures/protocol/valid-applied.json"
    ))
    .unwrap()
}
fn params(id: &str) -> BenchmarkParams {
    BenchmarkParams {
        request_id: id.into(),
        fixture_id: FixtureId::SmokeV1,
        profile_id: ProfileId::WebgpuSmokeV1,
    }
}
#[test]
fn cancelled_is_terminal() {
    let mut r = RunManager::new();
    let x = r.start(params("a"), 0, &output()).unwrap();
    r.cancel(&x.id).unwrap();
    assert_eq!(r.status(&x.id, 200000).unwrap().state, RunState::Cancelled);
}
#[test]
fn idempotence_busy_backend_and_loss() {
    let mut r = RunManager::new();
    let x = r.start(params("a"), 0, &output()).unwrap();
    assert_eq!(r.start(params("a"), 0, &output()).unwrap().id, x.id);
    assert_eq!(
        r.start(params("b"), 0, &output()).unwrap_err().code,
        ErrorCode::Busy
    );
    let mut p = params("a");
    p.profile_id = ProfileId::Webgl2SmokeV1;
    assert_eq!(
        r.start(p, 0, &output()).unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(r.status(&x.id, 501).unwrap().state, RunState::Failed);
    let mut r = RunManager::new();
    let mut p = params("c");
    p.profile_id = ProfileId::Webgl2SmokeV1;
    assert_eq!(
        r.start(p, 0, &output()).unwrap_err().code,
        ErrorCode::Unsupported
    );
}
#[test]
fn warmup_measurement_and_deduplication() {
    let mut r = RunManager::new();
    let x = r.start(params("a"), 0, &output()).unwrap();
    let mut f = output();
    for t in (100..=150000).step_by(100) {
        f.sequence += 1;
        r.observe(&f, t);
        r.observe(&f, t);
    }
    assert_eq!(r.status(&x.id, 150000).unwrap().state, RunState::Complete);
    let s: serde_json::Value = serde_json::from_slice(r.summary(&x.id).unwrap()).unwrap();
    assert_eq!(s["count"], 1200);
}
fn png() -> Vec<u8> {
    let mut b = vec![];
    {
        let mut e = png::Encoder::new(&mut b, 1, 1);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.write_header()
            .unwrap()
            .write_image_data(&[0, 0, 0, 255])
            .unwrap();
    }
    b
}
fn capture() -> CaptureParams {
    CaptureParams {
        output_id: "output_main".into(),
        expected_revision: 0,
        preset: CapturePreset::DiagnosticV1,
        max_age_ms: 500,
    }
}
fn store() -> CaptureStore {
    CaptureStore::new("session_smoke".into(), "commit".into(), "smoke_v1".into())
}
fn insert(
    s: &mut CaptureStore,
    p: CaptureParams,
    f: FrameApplied,
    b: Vec<u8>,
    received: u64,
    now: u64,
) -> Result<CaptureRecord, AppError> {
    s.insert(
        "client",
        p,
        f,
        b,
        received,
        now,
        "2026-10-03T00:00:00Z".into(),
    )
}
#[test]
fn capture_validation_rate_and_eviction() {
    let mut s = store();
    let mut p = capture();
    p.expected_revision = 1;
    assert_eq!(
        insert(&mut s, p, output(), png(), 0, 0).unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        insert(&mut s, capture(), output(), png(), 0, 501)
            .unwrap_err()
            .code,
        ErrorCode::StaleFrame
    );
    let mut f = output();
    f.output_id = "other".into();
    assert!(insert(&mut s, capture(), f, png(), 0, 0).is_err());
    let mut f = output();
    f.session_id = "other".into();
    assert!(insert(&mut s, capture(), f, png(), 0, 0).is_err());
    assert!(insert(&mut s, capture(), output(), vec![0; 2097153], 0, 0).is_err());
    assert!(insert(&mut s, capture(), output(), vec![0; 10], 0, 0).is_err());
    let first = insert(&mut s, capture(), output(), png(), 0, 0).unwrap();
    assert_eq!(
        insert(&mut s, capture(), output(), png(), 0, 0)
            .unwrap_err()
            .code,
        ErrorCode::RateLimited
    );
    for t in (1000..=8000).step_by(1000) {
        insert(&mut s, capture(), output(), png(), t, t).unwrap();
    }
    assert_eq!(s.read(&first.id).unwrap_err().code, ErrorCode::NotFound);
    assert!(s.manifest(&first.id).is_err());
}
#[test]
fn terminal_history_is_bounded() {
    let mut r = RunManager::new();
    let first = r.start(params("first"), 0, &output()).unwrap();
    r.cancel(&first.id).unwrap();
    for i in 0..8 {
        let x = r.start(params(&format!("r{i}")), 0, &output()).unwrap();
        r.cancel(&x.id).unwrap();
    }
    assert!(r.status(&first.id, 0).is_err());
    assert!(r.summary(&first.id).is_err());
}

#[test]
fn status_boundaries_and_terminal_progress() {
    let mut r = RunManager::new();
    let x = r.start(params("boundaries"), 0, &output()).unwrap();
    let mut f = output();
    for t in (500..=30000).step_by(500) {
        f.sequence += 1;
        r.observe(&f, t);
    }
    assert_eq!(r.status(&x.id, 30000).unwrap().state, RunState::Measuring);
    assert!(r.summary(&x.id).is_err());
    let cancelled = r.cancel(&x.id).unwrap();
    assert_eq!(
        r.status(&x.id, 999999).unwrap().progress,
        cancelled.progress
    );
    assert!(!r.is_active());
}

#[test]
fn invalid_dimensions_truncation_and_future_receive_time_are_rejected() {
    let mut s = store();
    let mut oversized = vec![];
    {
        let e = png::Encoder::new(&mut oversized, 1921, 1);
        e.write_header()
            .unwrap()
            .write_image_data(&vec![0; 1921])
            .unwrap();
    }
    assert!(insert(&mut s, capture(), output(), oversized, 0, 0).is_err());
    let mut truncated = png();
    truncated.truncate(truncated.len() - 12);
    assert!(insert(&mut s, capture(), output(), truncated, 0, 0).is_err());
    assert_eq!(
        insert(&mut s, capture(), output(), png(), 1, 0)
            .unwrap_err()
            .code,
        ErrorCode::StaleFrame
    );
    let record = insert(&mut s, capture(), output(), png(), 0, 500).unwrap();
    assert_eq!(s.record(&record.id).unwrap(), &record);
    s.manifest(&record.id).unwrap().validate().unwrap();
    assert_eq!(s.read(&record.id).unwrap(), png());
}

#[test]
fn unrelated_and_duplicate_acknowledgements_do_not_refresh_a_run() {
    let mut r = RunManager::new();
    let x = r.start(params("stale"), 0, &output()).unwrap();
    r.observe(&output(), 500);
    let mut f = output();
    f.sequence += 1;
    f.session_id = "other".into();
    r.observe(&f, 500);
    assert_eq!(r.status(&x.id, 501).unwrap().state, RunState::Failed);
}

#[test]
fn rate_limit_precedes_decode_and_failed_capture_does_not_reserve_rate() {
    let mut s = store();
    assert_eq!(
        insert(&mut s, capture(), output(), vec![0; 10], 0, 0)
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    insert(&mut s, capture(), output(), png(), 0, 0).unwrap();
    assert_eq!(
        insert(&mut s, capture(), output(), vec![0; 10], 0, 0)
            .unwrap_err()
            .code,
        ErrorCode::RateLimited
    );
    assert_eq!(
        s.insert(
            "other",
            capture(),
            output(),
            vec![0; 10],
            0,
            0,
            "2026-10-03T00:00:00Z".into()
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidInput
    );
}
#[test]
fn replay_preserves_terminal_identity_without_output_checks() {
    let mut runs = RunManager::new();
    assert!(runs.replay(&params("retry")).is_none());
    let started = runs.start(params("retry"), 0, &output()).unwrap();
    let terminal = runs.cancel(&started.id).unwrap();
    assert_eq!(runs.replay(&params("retry")).unwrap().unwrap(), terminal);
    let mut changed = params("retry");
    changed.profile_id = ProfileId::Webgl2SmokeV1;
    assert_eq!(
        runs.replay(&changed).unwrap().unwrap_err().code,
        ErrorCode::Conflict
    );
}
#[test]
fn summary_retains_maximum_interval() {
    let mut runs = RunManager::new();
    let run = runs.start(params("max"), 0, &output()).unwrap();
    let mut f = output();
    for t in (100..=30100).step_by(100) {
        f.sequence += 1;
        runs.observe(&f, t);
    }
    f.sequence += 1;
    runs.observe(&f, 30250);
    runs.cancel(&run.id).unwrap();
    let summary: serde_json::Value =
        serde_json::from_slice(runs.summary(&run.id).unwrap()).unwrap();
    assert_eq!(summary["intervalMs"]["max"], 150.0);
}
#[test]
fn removing_capture_revokes_bytes_metadata_and_manifest_but_preserves_rate() {
    let mut s = store();
    let record = insert(&mut s, capture(), output(), png(), 0, 0).unwrap();
    s.remove(&record.id);
    assert_eq!(s.read(&record.id).unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(s.record(&record.id).unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(
        s.manifest(&record.id).unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        insert(&mut s, capture(), output(), png(), 0, 0)
            .unwrap_err()
            .code,
        ErrorCode::RateLimited
    );
}
