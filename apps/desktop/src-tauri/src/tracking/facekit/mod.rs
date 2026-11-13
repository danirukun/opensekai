//! Native macOS FaceKit face tracking (TRK-24 B33). One session at most: the holder source
//! owns the camera run, and its events reach the status through a sink with a run token.
pub mod adapter;
#[cfg(target_os = "macos")]
mod macos;
pub mod mapping;
// macOS uses the real adapter; the stub stays for the unit tests there.
#[cfg(any(not(target_os = "macos"), test))]
mod stub;
use super::{aged, count, lock};
use adapter::*;
#[cfg(target_os = "macos")]
pub use macos::{probe, probe_at, FaceKitProbe, MacFaceAdapter};
use opensekai_contracts::*;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Instant,
};

/// The FaceKit adapter of this platform. A mobile build keeps the stub.
pub fn platform_adapter() -> Arc<dyn FaceAdapter> {
    #[cfg(target_os = "macos")]
    {
        Arc::new(MacFaceAdapter::new())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(stub::StubFaceAdapter)
    }
}
struct Source {
    generation: u64,
    config: TrackingConfig,
    failed: bool,
}
struct Session {
    id: String,
    generation: u64,
    token: u64,
    /// False after a terminal event: the run stays until the next reconcile or the shutdown drops it.
    live: bool,
}
#[derive(Default)]
struct State {
    sources: BTreeMap<String, Source>,
    statuses: BTreeMap<String, TrackingStatus>,
    sample: Option<TrackingSample>,
    session: Option<Session>,
    run: Option<Box<dyn FaceRun>>,
    tokens: u64,
    stopped: bool,
}
pub struct FaceKitManager {
    clock: Instant,
    adapter: Arc<dyn FaceAdapter>,
    state: Arc<Mutex<State>>,
    /// Keeps reconcile and shutdown in sequence. The sink never takes it, so a run can be
    /// started and dropped under it while the sink takes `state`.
    ops: Mutex<()>,
}
fn enabled_device(config: &TrackingConfig) -> Option<&str> {
    match config {
        TrackingConfig::FaceKit {
            enabled: true,
            device_id,
        } => Some(device_id),
        _ => None,
    }
}
fn fresh(id: &str, generation: u64, enabled: bool) -> TrackingStatus {
    TrackingStatus {
        source_id: id.into(),
        generation,
        state: if enabled {
            TrackingState::Waiting
        } else {
            TrackingState::Stopped
        },
        packets: 0,
        invalid_packets: 0,
        last_received_at_ms: None,
        error: None,
        inference_ms: None,
        unmatched_packets: None,
    }
}
type Parts = Option<(TrackingBone, BTreeMap<String, f64>)>;
fn on_event(state: &mut State, token: u64, now_ms: f64, event: FaceEvent, parts: Parts) {
    let Some(session) = state
        .session
        .as_mut()
        .filter(|s| s.live && s.token == token)
    else {
        return;
    };
    let (id, generation) = (session.id.clone(), session.generation);
    let terminal = match event {
        FaceEvent::Unavailable(reason) => Some((TrackingState::Unavailable, Some(reason))),
        FaceEvent::PermissionNeeded => Some((TrackingState::PermissionNeeded, None)),
        FaceEvent::CameraFailed(reason) => Some((TrackingState::Error, Some(reason))),
        FaceEvent::Face { inference_ms, .. } => {
            let Some(status) = state.statuses.get_mut(&id) else {
                return;
            };
            let Some((bone, expressions)) = parts else {
                status.invalid_packets = count(status.invalid_packets);
                return;
            };
            status.packets = count(status.packets);
            status.inference_ms = Some(inference_ms);
            status.state = TrackingState::Receiving;
            status.last_received_at_ms = Some(now_ms);
            status.error = None;
            state.sample = Some(TrackingSample {
                source_id: id.clone(),
                generation,
                received_at_ms: now_ms,
                bones: BTreeMap::from([("head".to_string(), bone)]),
                expressions,
                root: None,
            });
            None
        }
        FaceEvent::NoFace => {
            if let Some(status) = state.statuses.get_mut(&id) {
                status.invalid_packets = count(status.invalid_packets);
            }
            None
        }
    };
    if let Some((next, reason)) = terminal {
        session.live = false;
        if let Some(source) = state.sources.get_mut(&id) {
            source.failed = true;
        }
        if let Some(status) = state.statuses.get_mut(&id) {
            status.state = next;
            status.error = reason;
        }
        state.sample = None;
    }
}
impl FaceKitManager {
    pub fn new(clock: Instant, adapter: Arc<dyn FaceAdapter>) -> Self {
        Self {
            clock,
            adapter,
            state: Arc::default(),
            ops: Mutex::new(()),
        }
    }
    fn sink(&self, token: u64) -> FaceSink {
        let (state, clock) = (Arc::downgrade(&self.state), self.clock);
        Arc::new(move |event| {
            let parts = match &event {
                FaceEvent::Face { frame, .. } => mapping::sample_parts(frame),
                _ => None,
            };
            let now_ms = clock.elapsed().as_secs_f64() * 1000.;
            if let Some(state) = state.upgrade() {
                on_event(&mut lock(&state), token, now_ms, event, parts);
            }
        })
    }
    /// One call for each new scene revision. A source that keeps its generation and config
    /// keeps its run, counters, and sample; a failed source waits for such a change.
    pub fn reconcile(&self, scene: &SceneView) {
        let _ops = lock(&self.ops);
        let desired: Vec<(&str, &str, u64, &TrackingConfig)> = scene
            .entities
            .iter()
            .filter_map(|e| match e {
                SceneEntity::Tracking {
                    id,
                    name,
                    generation,
                    config: config @ TrackingConfig::FaceKit { .. },
                    ..
                } => Some((id.as_str(), name.as_str(), *generation, config)),
                _ => None,
            })
            .collect();
        let (old, start) = {
            let mut guard = lock(&self.state);
            let state = &mut *guard;
            if state.stopped {
                return;
            }
            state.sources.retain(|id, s| {
                let keep = desired
                    .iter()
                    .any(|(d, _, g, c)| d == id && *g == s.generation && *c == &s.config);
                if !keep {
                    state.statuses.remove(id);
                    if state.sample.as_ref().is_some_and(|s| &s.source_id == id) {
                        state.sample = None;
                    }
                }
                keep
            });
            let sources = &state.sources;
            let mut old = None;
            if state
                .session
                .as_ref()
                .is_some_and(|s| sources.get(&s.id).is_none_or(|s| s.failed))
            {
                state.session = None;
                old = state.run.take();
            }
            for (id, _, generation, config) in &desired {
                if !state.sources.contains_key(*id) {
                    let enabled = enabled_device(config).is_some();
                    state
                        .statuses
                        .insert(id.to_string(), fresh(id, *generation, enabled));
                    state.sources.insert(
                        id.to_string(),
                        Source {
                            generation: *generation,
                            config: (*config).clone(),
                            failed: false,
                        },
                    );
                }
            }
            let candidates: Vec<_> = desired
                .iter()
                .filter(|(id, _, _, config)| {
                    enabled_device(config).is_some()
                        && state.sources.get(*id).is_some_and(|s| !s.failed)
                })
                .collect();
            let mut start = None;
            if state.session.is_none() {
                if let Some((id, _, generation, config)) = candidates.first() {
                    state.tokens += 1;
                    let token = state.tokens;
                    state.session = Some(Session {
                        id: id.to_string(),
                        generation: *generation,
                        token,
                        live: true,
                    });
                    state
                        .statuses
                        .insert(id.to_string(), fresh(id, *generation, true));
                    start = enabled_device(config).map(|d| (d.to_string(), token));
                }
            }
            if let Some(holder) = state.session.as_ref().map(|s| s.id.as_str()) {
                let name = desired.iter().find(|d| d.0 == holder).map_or("", |d| d.1);
                for (id, ..) in candidates.iter().filter(|c| c.0 != holder) {
                    if let Some(status) = state.statuses.get_mut(*id) {
                        status.state = TrackingState::Error;
                        status.error = Some(format!("FaceKit used by {name}"));
                    }
                }
            }
            (old, start)
        };
        // The old run stops the camera before the next run opens it. No lock on `state` here:
        // a run's drop waits for the capture, and the capture may wait in the sink.
        drop(old);
        if let Some((device_id, token)) = start {
            let run = self.adapter.start(&device_id, self.sink(token));
            let mut state = lock(&self.state);
            if state.session.as_ref().is_some_and(|s| s.token == token) {
                state.run = Some(run);
            } else {
                drop(state);
                drop(run);
            }
        }
    }
    pub fn snapshot(&self, now_ms: f64) -> TrackingUpdate {
        let state = lock(&self.state);
        TrackingUpdate {
            samples: state.sample.iter().cloned().collect(),
            statuses: state
                .statuses
                .values()
                .map(|s| aged(s.clone(), now_ms))
                .collect(),
        }
    }
    pub fn shutdown(&self) {
        let _ops = lock(&self.ops);
        let run = {
            let mut state = lock(&self.state);
            state.stopped = true;
            state.session = None;
            state.sources.clear();
            state.statuses.clear();
            state.sample = None;
            state.run.take()
        };
        drop(run);
    }
    pub fn cameras(&self) -> Vec<CameraInfo> {
        self.adapter.cameras()
    }
}
// The sinks hold a weak `state`; this drops the run here and not in a sink on the adapter's thread.
impl Drop for FaceKitManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use std::time::Instant;

    #[derive(Default)]
    pub(crate) struct FakeAdapter {
        starts: Mutex<Vec<(String, FaceSink)>>,
        drops: Arc<AtomicUsize>,
    }
    struct FakeRun(Arc<AtomicUsize>);
    impl FaceRun for FakeRun {}
    impl Drop for FakeRun {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl FaceAdapter for FakeAdapter {
        fn cameras(&self) -> Vec<CameraInfo> {
            vec![]
        }
        fn start(&self, device_id: &str, sink: FaceSink) -> Box<dyn FaceRun> {
            self.starts.lock().unwrap().push((device_id.into(), sink));
            Box::new(FakeRun(self.drops.clone()))
        }
    }
    impl FakeAdapter {
        pub(crate) fn starts(&self) -> usize {
            self.starts.lock().unwrap().len()
        }
        pub(crate) fn drops(&self) -> usize {
            self.drops.load(Ordering::SeqCst)
        }
        fn device(&self, n: usize) -> String {
            self.starts.lock().unwrap()[n].0.clone()
        }
        pub(crate) fn send(&self, n: usize, event: FaceEvent) {
            let sink = self.starts.lock().unwrap()[n].1.clone();
            sink(event);
        }
    }
    type Row<'a> = (&'a str, &'a str, u64, bool, &'a str);
    pub(crate) fn tracking(
        id: &str,
        name: &str,
        generation: u64,
        config: TrackingConfig,
    ) -> SceneEntity {
        SceneEntity::Tracking {
            smoothing: None,
            calibration: None,
            mapping: None,
            id: id.into(),
            name: name.into(),
            visible: true,
            transform: Transform {
                position: [0.; 3],
                rotation: [0., 0., 0., 1.],
                scale: [1.; 3],
            },
            generation,
            config,
        }
    }
    fn scene(revision: u64, rows: &[Row]) -> SceneView {
        SceneView {
            schema_version: 1,
            scene_id: "s".into(),
            revision,
            outputs: vec![],
            entities: rows
                .iter()
                .map(|(id, name, generation, enabled, device_id)| {
                    let config = TrackingConfig::FaceKit {
                        enabled: *enabled,
                        device_id: (*device_id).into(),
                    };
                    tracking(id, name, *generation, config)
                })
                .collect(),
        }
    }
    pub(crate) fn face(inference_ms: f64) -> FaceEvent {
        FaceEvent::Face {
            frame: FaceFrame {
                blendshapes: [0.25; 51],
                tongue_out: None,
                rotation: [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]],
            },
            inference_ms,
        }
    }
    fn setup() -> (Arc<FakeAdapter>, FaceKitManager) {
        let fake = Arc::new(FakeAdapter::default());
        let manager = FaceKitManager::new(Instant::now(), fake.clone());
        (fake, manager)
    }
    fn status(manager: &FaceKitManager, id: &str) -> TrackingStatus {
        manager
            .snapshot(0.)
            .statuses
            .into_iter()
            .find(|s| s.source_id == id)
            .unwrap()
    }
    const A: Row = ("a", "A", 1, true, "cam-1");

    #[test]
    fn starts_one_run_for_an_enabled_source() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        assert_eq!(fake.starts(), 1);
        assert_eq!(fake.device(0), "cam-1");
        let s = status(&manager, "a");
        assert_eq!(s.state, TrackingState::Waiting);
        assert_eq!(s.packets, 0);
        assert_eq!(s.error, None);
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[("a", "A", 1, false, "cam-1")]));
        assert_eq!(fake.starts(), 0);
        assert_eq!(status(&manager, "a").state, TrackingState::Stopped);
    }

    #[test]
    fn face_event_gives_a_sample_and_receiving() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        fake.send(0, face(5.));
        let s = status(&manager, "a");
        let last = s.last_received_at_ms.unwrap();
        let update = manager.snapshot(last);
        assert_eq!(update.samples.len(), 1);
        assert!(update.samples[0].bones.contains_key("head"));
        assert_eq!(update.samples[0].received_at_ms, last);
        assert_eq!(update.statuses[0].state, TrackingState::Receiving);
        assert_eq!(update.statuses[0].packets, 1);
        assert_eq!(update.statuses[0].inference_ms, Some(5.));
        let stale = manager.snapshot(last + 501.);
        assert_eq!(stale.statuses[0].state, TrackingState::Stale);
        assert_eq!(stale.samples.len(), 1);
        fake.send(0, face(6.));
        let s = status(&manager, "a");
        let update = manager.snapshot(s.last_received_at_ms.unwrap());
        assert_eq!(update.statuses[0].state, TrackingState::Receiving);
        assert_eq!(update.statuses[0].packets, 2);
    }

    #[test]
    fn no_face_and_bad_values_count_invalid() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        fake.send(0, FaceEvent::NoFace);
        fake.send(0, FaceEvent::NoFace);
        let mut bad = FaceFrame {
            blendshapes: [0.; 51],
            tongue_out: None,
            rotation: [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]],
        };
        bad.blendshapes[3] = f32::NAN;
        fake.send(
            0,
            FaceEvent::Face {
                frame: bad,
                inference_ms: 4.,
            },
        );
        let update = manager.snapshot(0.);
        assert_eq!(update.statuses[0].state, TrackingState::Waiting);
        assert_eq!(update.statuses[0].invalid_packets, 3);
        assert!(update.samples.is_empty());
    }

    #[test]
    fn terminal_events_end_the_run() {
        let cases = [
            (
                FaceEvent::Unavailable("FaceKit library not found".into()),
                TrackingState::Unavailable,
                Some("FaceKit library not found"),
            ),
            (
                FaceEvent::PermissionNeeded,
                TrackingState::PermissionNeeded,
                None,
            ),
            (
                FaceEvent::CameraFailed("Camera stopped".into()),
                TrackingState::Error,
                Some("Camera stopped"),
            ),
        ];
        for (event, state, reason) in cases {
            let (fake, manager) = setup();
            manager.reconcile(&scene(1, &[A]));
            fake.send(0, face(5.));
            fake.send(0, event);
            let update = manager.snapshot(0.);
            assert_eq!(update.statuses[0].state, state);
            assert_eq!(update.statuses[0].error.as_deref(), reason);
            assert!(update.samples.is_empty());
            assert_eq!(fake.drops(), 0);
            manager.reconcile(&scene(2, &[A]));
            assert_eq!(fake.drops(), 1);
            assert_eq!(fake.starts(), 1);
            assert_eq!(status(&manager, "a").state, state);
        }
    }

    #[test]
    fn failed_source_retries_only_after_a_config_change() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        fake.send(
            0,
            FaceEvent::Unavailable("FaceKit library not found".into()),
        );
        manager.reconcile(&scene(2, &[A]));
        manager.reconcile(&scene(3, &[A]));
        assert_eq!(fake.starts(), 1);
        assert_eq!(status(&manager, "a").state, TrackingState::Unavailable);
        manager.reconcile(&scene(4, &[("a", "A", 1, false, "cam-1")]));
        manager.reconcile(&scene(5, &[A]));
        assert_eq!(fake.starts(), 2);
        assert_eq!(status(&manager, "a").state, TrackingState::Waiting);
    }

    #[test]
    fn unrelated_revision_keeps_the_run() {
        let (fake, manager) = setup();
        for revision in 1..=3 {
            manager.reconcile(&scene(revision, &[A]));
        }
        assert_eq!(fake.starts(), 1);
        assert_eq!(fake.drops(), 0);
    }

    #[test]
    fn camera_or_generation_change_restarts() {
        for (next, device) in [
            (("a", "A", 1, true, "cam-2"), "cam-2"),
            (("a", "A", 2, true, "cam-1"), "cam-1"),
        ] {
            let (fake, manager) = setup();
            manager.reconcile(&scene(1, &[A]));
            fake.send(0, face(5.));
            manager.reconcile(&scene(2, &[next]));
            assert_eq!(fake.drops(), 1);
            assert_eq!(fake.starts(), 2);
            assert_eq!(fake.device(1), device);
            let update = manager.snapshot(0.);
            assert!(update.samples.is_empty());
            assert_eq!(update.statuses[0].packets, 0);
            assert_eq!(update.statuses[0].state, TrackingState::Waiting);
        }
    }

    #[test]
    fn disable_and_removal_stop_the_run() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        fake.send(0, face(5.));
        manager.reconcile(&scene(2, &[("a", "A", 1, false, "cam-1")]));
        assert_eq!(fake.drops(), 1);
        let update = manager.snapshot(0.);
        assert_eq!(update.statuses[0].state, TrackingState::Stopped);
        assert!(update.samples.is_empty());
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        fake.send(0, face(5.));
        manager.reconcile(&scene(2, &[]));
        assert_eq!(fake.drops(), 1);
        let update = manager.snapshot(0.);
        assert!(update.statuses.is_empty());
        assert!(update.samples.is_empty());
    }

    #[test]
    fn old_run_events_are_ignored() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        manager.reconcile(&scene(2, &[("a", "A", 1, false, "cam-1")]));
        fake.send(0, face(5.));
        let update = manager.snapshot(0.);
        assert!(update.samples.is_empty());
        assert_eq!(update.statuses[0].state, TrackingState::Stopped);
        assert_eq!(update.statuses[0].packets, 0);
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        manager.reconcile(&scene(2, &[("a", "A", 1, true, "cam-2")]));
        fake.send(0, face(5.));
        fake.send(0, FaceEvent::CameraFailed("Camera stopped".into()));
        let s = status(&manager, "a");
        assert_eq!(s.state, TrackingState::Waiting);
        assert_eq!(s.packets, 0);
        assert_eq!(s.error, None);
    }

    #[test]
    fn second_source_is_an_error_and_takes_over() {
        let (fake, manager) = setup();
        let b: Row = ("b", "B", 1, true, "cam-2");
        manager.reconcile(&scene(1, &[A, b]));
        assert_eq!(fake.starts(), 1);
        assert_eq!(fake.device(0), "cam-1");
        let s = status(&manager, "b");
        assert_eq!(s.state, TrackingState::Error);
        assert_eq!(s.error.as_deref(), Some("FaceKit used by A"));
        manager.reconcile(&scene(2, &[b, A]));
        assert_eq!(fake.starts(), 1);
        assert_eq!(fake.drops(), 0);
        assert_eq!(status(&manager, "a").state, TrackingState::Waiting);
        assert_eq!(status(&manager, "b").state, TrackingState::Error);
        manager.reconcile(&scene(3, &[b, ("a", "A", 1, false, "cam-1")]));
        assert_eq!(fake.drops(), 1);
        assert_eq!(fake.starts(), 2);
        assert_eq!(fake.device(1), "cam-2");
        let s = status(&manager, "b");
        assert_eq!(s.state, TrackingState::Waiting);
        assert_eq!(s.error, None);
    }

    #[test]
    fn shutdown_drops_the_run() {
        let (fake, manager) = setup();
        manager.reconcile(&scene(1, &[A]));
        fake.send(0, face(5.));
        manager.shutdown();
        assert_eq!(fake.drops(), 1);
        let empty = manager.snapshot(0.);
        assert!(empty.statuses.is_empty() && empty.samples.is_empty());
        fake.send(0, face(5.));
        fake.send(0, FaceEvent::CameraFailed("Camera stopped".into()));
        manager.reconcile(&scene(2, &[A]));
        let empty = manager.snapshot(0.);
        assert!(empty.statuses.is_empty() && empty.samples.is_empty());
        assert_eq!(fake.starts(), 1);
        assert_eq!(fake.drops(), 1);
    }

    #[test]
    fn stub_reports_unavailable() {
        let manager = FaceKitManager::new(Instant::now(), Arc::new(stub::StubFaceAdapter));
        manager.reconcile(&scene(1, &[A]));
        let s = status(&manager, "a");
        assert_eq!(s.state, TrackingState::Unavailable);
        assert_eq!(s.error.as_deref(), Some("FaceKit needs macOS"));
        assert!(manager.cameras().is_empty());
        manager.reconcile(&scene(2, &[A]));
        assert_eq!(status(&manager, "a").state, TrackingState::Unavailable);
    }
}
