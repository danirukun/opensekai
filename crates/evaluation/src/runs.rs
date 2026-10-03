use crate::error;
use opensekai_contracts::*;
use std::collections::VecDeque;
const SAMPLE_LIMIT: usize = 8192;
struct Entry {
    params: BenchmarkParams,
    run: BenchmarkRun,
    started: u64,
    last: u64,
    session: String,
    output: String,
    sequence: u64,
    count: u64,
    gpu_unknown: u64,
    warnings: u64,
    cpu: Vec<f64>,
    intervals: Vec<f64>,
    measured_last: Option<u64>,
    summary: Vec<u8>,
}
#[derive(Default)]
pub struct RunManager {
    entries: VecDeque<Entry>,
}
impl RunManager {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn is_active(&self) -> bool {
        self.entries.iter().any(|e| active(&e.run.state))
    }
    pub fn start(
        &mut self,
        params: BenchmarkParams,
        now_ms: u64,
        output: &FrameApplied,
    ) -> Result<BenchmarkRun, AppError> {
        params.validate()?;
        output.validate()?;
        if let Some(e) = self
            .entries
            .iter()
            .find(|e| e.params.request_id == params.request_id)
        {
            return if e.params == params {
                Ok(e.run.clone())
            } else {
                Err(error(ErrorCode::Conflict, "request parameters changed"))
            };
        }
        if self.is_active() {
            return Err(error(ErrorCode::Busy, "benchmark is active"));
        }
        let backend = match params.profile_id {
            ProfileId::WebgpuSmokeV1 => Backend::Webgpu,
            ProfileId::Webgl2SmokeV1 => Backend::Webgl2,
        };
        if output.backend != backend {
            return Err(error(ErrorCode::Unsupported, "profile backend mismatch"));
        }
        let run = BenchmarkRun {
            id: uuid::Uuid::new_v4().to_string(),
            state: RunState::Warming,
            progress: 0.,
            summary_resource_uri: None,
            error: None,
        };
        self.entries.push_back(Entry {
            params,
            run: run.clone(),
            started: now_ms,
            last: now_ms,
            session: output.session_id.clone(),
            output: output.output_id.clone(),
            sequence: output.sequence,
            count: 0,
            gpu_unknown: 0,
            warnings: 0,
            cpu: vec![],
            intervals: vec![],
            measured_last: None,
            summary: vec![],
        });
        self.prune();
        Ok(run)
    }
    pub fn observe(&mut self, frame: &FrameApplied, now_ms: u64) {
        let Some(e) = self.entries.iter_mut().find(|e| active(&e.run.state)) else {
            return;
        };
        if frame.validate().is_err()
            || frame.session_id != e.session
            || frame.output_id != e.output
            || frame.sequence <= e.sequence
        {
            return;
        }
        let backend = match e.params.profile_id {
            ProfileId::WebgpuSmokeV1 => Backend::Webgpu,
            ProfileId::Webgl2SmokeV1 => Backend::Webgl2,
        };
        if frame.backend != backend {
            return;
        }
        // A new acknowledgement cannot repair a gap that already exceeded the native freshness budget.
        update(e, now_ms);
        if !active(&e.run.state) {
            self.prune();
            return;
        }
        e.sequence = frame.sequence;
        e.last = now_ms;
        let elapsed = now_ms.saturating_sub(e.started);
        if (30000..150000).contains(&elapsed) {
            e.count += 1;
            e.gpu_unknown += u64::from(frame.gpu_ms.is_none());
            e.warnings = e.warnings.saturating_add(frame.warnings.len() as u64);
            if e.cpu.len() < SAMPLE_LIMIT {
                e.cpu.push(frame.cpu_ms);
            }
            if let Some(previous) = e.measured_last {
                if e.intervals.len() < SAMPLE_LIMIT {
                    e.intervals.push(now_ms.saturating_sub(previous) as f64);
                }
            }
            e.measured_last = Some(now_ms);
        }
    }
    pub fn status(&mut self, run_id: &str, now_ms: u64) -> Result<BenchmarkRun, AppError> {
        let e = self
            .entries
            .iter_mut()
            .find(|e| e.run.id == run_id)
            .ok_or_else(|| error(ErrorCode::NotFound, "run not found"))?;
        update(e, now_ms);
        let run = e.run.clone();
        self.prune();
        Ok(run)
    }
    pub fn cancel(&mut self, run_id: &str) -> Result<BenchmarkRun, AppError> {
        let e = self
            .entries
            .iter_mut()
            .find(|e| e.run.id == run_id)
            .ok_or_else(|| error(ErrorCode::NotFound, "run not found"))?;
        if active(&e.run.state) {
            e.run.state = RunState::Cancelled;
            e.run.error = Some(ErrorCode::Cancelled);
            finish(e);
        }
        let run = e.run.clone();
        self.prune();
        Ok(run)
    }
    pub fn summary(&self, run_id: &str) -> Result<&[u8], AppError> {
        let e = self
            .entries
            .iter()
            .find(|e| e.run.id == run_id)
            .ok_or_else(|| error(ErrorCode::NotFound, "run not found"))?;
        if active(&e.run.state) {
            return Err(error(ErrorCode::Unavailable, "summary is not terminal"));
        }
        Ok(&e.summary)
    }
    fn prune(&mut self) {
        while self
            .entries
            .iter()
            .filter(|e| !active(&e.run.state))
            .count()
            > 8
        {
            if let Some(i) = self.entries.iter().position(|e| !active(&e.run.state)) {
                self.entries.remove(i);
            }
        }
    }
}
fn active(state: &RunState) -> bool {
    matches!(state, RunState::Warming | RunState::Measuring)
}
fn update(e: &mut Entry, now: u64) {
    if !active(&e.run.state) {
        return;
    }
    let elapsed = now.saturating_sub(e.started);
    e.run.progress = (elapsed as f64 / 150000.).min(1.);
    if now.saturating_sub(e.last) > 500 {
        e.run.state = RunState::Failed;
        e.run.error = Some(ErrorCode::StaleFrame);
        finish(e);
    } else if elapsed >= 150000 {
        e.run.state = RunState::Complete;
        finish(e);
    } else if elapsed >= 30000 {
        e.run.state = RunState::Measuring;
    }
}
fn percentiles(v: &mut [f64]) -> serde_json::Value {
    if v.is_empty() {
        return serde_json::Value::Null;
    }
    v.sort_by(f64::total_cmp);
    serde_json::json!({"p50":v[(v.len()-1)/2],"p95":v[(v.len()-1)*95/100],"p99":v[(v.len()-1)*99/100]})
}
fn finish(e: &mut Entry) {
    e.run.summary_resource_uri = Some(format!("opensekai://evidence/{}/summary.json", e.run.id));
    let cpu = percentiles(&mut e.cpu);
    let intervals = percentiles(&mut e.intervals);
    let summary = serde_json::json!({"run":e.run,"fixtureId":e.params.fixture_id,"profileId":e.params.profile_id,"count":e.count,"cpuMs":cpu,"intervalMs":intervals,"gpuMs":null,"gpuUnknownCount":e.gpu_unknown,"staleOutputPeriods":u64::from(e.run.state==RunState::Failed),"resourceWarningCount":e.warnings,"sampleLimit":SAMPLE_LIMIT,"samplesTruncated":e.count>SAMPLE_LIMIT as u64,"hardwareAcceptance":"unknown"});
    e.summary = summary.to_string().into_bytes();
    e.cpu.clear();
    e.intervals.clear();
}
