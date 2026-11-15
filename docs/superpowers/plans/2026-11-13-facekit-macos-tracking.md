# FaceKit Tracking on macOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `facekit` tracking source drives the face and head of a Character from the Mac camera through the private AppleCVA face tracker, with explicit states when it cannot run.

**Architecture:** The Rust host owns one FaceKit session beside the UDP receiver. A platform adapter (macOS implementation with `objc2`, a stub elsewhere) sends events to a session manager, and `TrackingManager` merges the manager's sample and status into the `TrackingUpdate` of the clock message. The session worker, smoothing, calibration, and face mapping are the existing ones. The editor adds the kind, a Camera select from a host command, and the new states.

**Tech Stack:** Rust (`objc2` 0.6, `block2`, `dispatch2`, `objc2-av-foundation`, `objc2-vision`, serde contracts crate, Tauri host), TypeScript (zod, vitest), Svelte 5 with `@oshi-connect/ui`, MCP server in `apps/mcp`.

**Spec:** `docs/superpowers/specs/2026-11-11-facekit-macos-tracking-design.md`. Read it with this plan. The spec owns the behaviour and the measured facts (Appendix A and B). The contract `spdd/prompt/2026-11-11-facekit-macos-tracking.md` gives each requirement a number (R1 to R23). This plan owns names, files, and tests.

## Global Constraints

- Branch `facekit-macos-tracking-e442d792`. Verify `pwd` before each Git command. Do not use `git -C` or `cd … &&`.
- Do not attribute a commit or a pull request to an agent. No `Co-Authored-By` trailer, no "Generated with" line. Do not push before Task 9.
- Commit subjects follow the repo style, for example `Add the FaceKit tracking kind and states (TRK-24 B33)`.
- Run each command that compiles Rust through `direnv exec . <command>`. In a new worktree, run `direnv allow` one time, then `direnv exec . cargo clean -p opensekai-desktop -p opensekai-contracts` before the first build (the Cargo target directory is shared). Do not build into a per-worktree `target/`.
- pnpm only. Functional TypeScript, plain data. Comment only logic that is hard to follow.
- Each contract change goes in TypeScript (`packages/contracts`) and Rust (`crates/contracts`) in the same task.
- Each Apple item in Rust is under `#[cfg(target_os = "macos")]`. Do not link AppleCVA at build time. Do not add an Apple file to the repository.
- Do not open `untrusted_applecva_vts/` in the session scratchpad. It is GPL code.
- Never read, store, log, or send `identity_coefficients`, `face_id`, a camera frame, or the callback dictionary.
- No code path starts, enables, or adds a different tracker when FaceKit fails.
- Update `ARCHITECTURE.md` in the commit that adds a module, a data path, a command, or a trust check.
- UI copy is short. No helper text that repeats a control. No badge, card grid, or gradient. Controls come from `@oshi-connect/ui`.
- Prose in documents follows ASD-STE100. A value that was not measured is "unknown".
- Spec values, copied exactly:
  - Config `{kind:'facekit', enabled:boolean, deviceId:string}`; default `enabled:false`, `deviceId:''`; `deviceId` at most 512 UTF-16 units.
  - New states `unavailable` and `permissionNeeded`. The stale limit is 500 ms.
  - Library path `/System/Library/PrivateFrameworks/AppleCVA.framework/Versions/A/AppleCVA`.
  - Create options: `num_tracked_faces` 1, `rgb_only` true, `robust_tongue` true, `network_failure_threshold_multiplier` 1.0, `failure_fov_modifier` 0.5, `use_recognition` false.
  - Blend shape data: 51 native-endian `float32` values (204 bytes). Rotation: 3 rows of 3 numbers. The 51 names and their order are in the spec, "Facts from the spike".
  - Menu name "FaceKit Tracker". Asset group "FaceKit Trackers". Inspector line "Uses a private macOS API. It can stop after a macOS update."
- Plan values (builder decisions; the analysis lists them):
  - Reason strings: "FaceKit needs macOS", "FaceKit library not found", "FaceKit output names changed", "FaceKit tracker did not start", "Unexpected FaceKit output", "Camera not found", "Camera cannot start", "Camera stopped", "FaceKit used by <name>".
  - Commands `facekit_camera_list` and `open_camera_settings`. Debug-build override `OPENSEKAI_FACEKIT_LIBRARY`.
  - `NSCameraUsageDescription`: "OpenSekai uses the camera for local avatar tracking after you start a camera tracker."
- Test commands:
  - `pnpm test:unit` (one file: `pnpm test:unit <path>`), `direnv exec . pnpm test:integration`, `pnpm check`
  - `direnv exec . cargo test --workspace --no-fail-fast`
  - `direnv exec . cargo clippy --workspace --all-targets`
  - Keep the files you change clean for `cargo fmt`.

## Review Focus

1. **A result arrives after the stop.** FaceKit calls back on its own thread, also after the capture stops. After a disable, a camera change, or a removal, an event of the old run must not make a sample or change a status. Test in Task 5 (`old_run_events_are_ignored`).
2. **The holder stops while a second source waits.** The second enabled source has "FaceKit used by …". When the holder is disabled or removed, the second source must get the session on that reconcile, with no change of its own config. Test in Task 5 (`second_source_is_an_error_and_takes_over`).
3. **The saved camera is hidden or not connected.** The Camera select must keep the saved camera selected (as "Unavailable camera" when it is not in the list). An **Apply** must not change `deviceId` to the default. Test in Task 8 (`cameraOptions`).
4. **The camera fails while a sample is fresh.** After `CameraFailed` or `Unavailable`, the host removes the sample at once and the session drops it. The avatar must not hold the last face as `receiving`. Tests in Task 3 and Task 5 (`terminal_events_end_the_run`).
5. **The source stops while the start is in progress.** The first `Create` takes up to 1.9 s and the camera prompt can stay open. A stop in that time must leave the camera off, and the start must not continue. Test in Task 6 (smoke run with `--stop-after-ms 200`).

## Execution order

- Tasks 1 to 3 run in sequence in this worktree. The integrator owns the contracts.
- Then two tracks run at the same time in separate worktrees from the commit of Task 3:
  - **Track H** (host): Tasks 4, 5, 6, 7 in sequence. Owns `apps/desktop/src-tauri/**`, `Cargo.lock`, `ARCHITECTURE.md`.
  - **Track E** (editor): Task 8. Owns `apps/desktop/src/**` and `apps/desktop/test/**`. It does not change `Cargo.toml`, `Cargo.lock`, `package.json`, or `pnpm-lock.yaml`.
- Task 9 merges both tracks. It needs the owner at the camera.

---

### Task 1: Probe tool, numeric fixture, feasibility record

The spike files are in `/private/tmp/claude-501/-Users-danirukun--paradev-worktrees-opensekai-work-e442d792/eea7e4cb-4ff8-407f-a5f3-68cc33a3f76d/scratchpad/spike/` (`facekit_spike.m`, `Info.plist`, `camera.entitlements`, `guided.command`, `guided.jsonl`, variant recordings). If the directory is gone, write the probe from spec Appendix A, and take the fixture rows from Appendix B only.

**Files:**
- Create: `tools/facekit-probe/facekit_probe.m`, `Info.plist`, `camera.entitlements`, `build.sh`, `README.md`, `.gitignore`
- Create: `fixtures/tracking/facekit-frames.json`
- Create: `docs/evaluation/facekit-feasibility.md`

**Interfaces:**
- Produces: `fixtures/tracking/facekit-frames.json` = `{"source":{"model","os","appleCva","apiVersion","camera"},"frames":[{"phase":string,"rotation":number[3][3],"blendshapes":number[51],"tongueOut":number}]}`, one frame for each of the phases `neutral`, `head_left`, `head_right`, `head_down`, `tilt_left`, `tilt_right`, `jaw_open`, `blink_left`, `smile`, `tongue`. Task 4 reads it.

- [ ] **Step 1:** Copy the spike source to `tools/facekit-probe/facekit_probe.m` with the plist and the entitlements. Rename the bundle ID to `net.oshi-connect.opensekai.facekit-probe`. `build.sh` holds the `clang` and ad hoc `codesign` commands. `.gitignore` excludes the binary, `*.jsonl`, and `*.log`.
- [ ] **Step 2:** Run `bash tools/facekit-probe/build.sh`. Expected: the binary builds. Do not run it (it needs the camera and Terminal.app).
- [ ] **Step 3:** Write the fixture from `guided.jsonl`. For each phase, use the rows with a face at 1.5 s or more after the phase start, and take the row in the middle of them by time. Copy `raw_rot` to `rotation`, `raw_bs` to `blendshapes`, `tongue` to `tongueOut`, each number rounded to 4 decimals. No other field goes in the file.
- [ ] **Step 4:** Write `README.md`: purpose, build, start from Terminal.app through a `.command` file, the output fields, and that recordings are not committed.
- [ ] **Step 5:** Write `docs/evaluation/facekit-feasibility.md` from the spec sections "Feasibility gate", "Facts from the spike", "Unknown", and Appendix B: host, versions, method, results table, the identity finding ("not read, not stored"; the stop of the identity computation is not verified), and each unknown.
- [ ] **Step 6:** Commit: `Add the FaceKit probe tool and feasibility record (TRK-24 B33)`.

### Task 2: Contracts — kind and states

**Files:**
- Modify: `packages/contracts/src/tracking.ts`, `crates/contracts/src/tracking.rs`, `fixtures/protocol/validation-vectors.json`
- Modify: `apps/desktop/src-tauri/src/tracking/mod.rs` (compile only), plus each TypeScript file that `pnpm check` rejects
- Test: `packages/contracts/test/live-tracking.test.ts`, `crates/contracts/tests/tracking.rs`

**Interfaces:**
- Produces (TS): `TrackingConfig` member `{kind:'facekit';enabled:boolean;deviceId:string}`; `FACE_ONLY_TRACKING_KINDS=['ifacialmocap','openseeface','facekit']`; `TrackingStatus['state']` with `'unavailable'|'permissionNeeded'`; `export const FAILED_TRACKING_STATES=['error','unavailable','permissionNeeded'] as const`.
- Produces (Rust): `TrackingConfig::FaceKit { enabled: bool, device_id: String }` with `#[serde(rename = "facekit")]`; `TrackingState::Unavailable => "unavailable"`, `TrackingState::PermissionNeeded => "permissionNeeded"`; `face_only()` is true for `FaceKit`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('gives the FaceKit defaults and keeps the kind face-only',()=>{
 expect(defaultTrackingConfig('facekit')).toEqual({kind:'facekit',enabled:false,deviceId:''});
 expect(FACE_ONLY_TRACKING_KINDS).toContain('facekit');
 expect(TrackingConfigSchema.safeParse({kind:'facekit',enabled:true,deviceId:'x'.repeat(513)}).success).toBe(false);
 expect(TrackingConfigSchema.safeParse({kind:'facekit',enabled:true,deviceId:'',mirror:false}).success).toBe(false);
});
it('accepts the two FaceKit states',()=>{
 for(const state of ['unavailable','permissionNeeded'] as const)expect(TrackingStatusSchema.safeParse({sourceId:'s',generation:1,state,packets:0,invalidPackets:0,lastReceivedAtMs:null,error:null}).success).toBe(true);
 expect(FAILED_TRACKING_STATES).toEqual(['error','unavailable','permissionNeeded']);
});
```

```rust
#[test]
fn facekit_config_and_states_round_trip() {
    let config: TrackingConfig = serde_json::from_str(r#"{"kind":"facekit","enabled":true,"deviceId":""}"#).unwrap();
    assert_eq!(config, TrackingConfig::FaceKit { enabled: true, device_id: String::new() });
    assert!(config.face_only() && config.validate().is_ok());
    assert!(TrackingConfig::FaceKit { enabled: true, device_id: "x".repeat(513) }.validate().is_err());
    assert!(serde_json::from_str::<TrackingConfig>(r#"{"kind":"facekit","enabled":true,"deviceId":"","mirror":false}"#).is_err());
    // The status JSON of the test above with each new state parses and serializes to the same state string.
}
```

Add three vectors by the pattern of `openseeface-face-source`: `facekit-face-source` (valid), `facekit-body-source` (`INVALID_INPUT`), `facekit-long-device-id` (`deviceId` of 513 characters, `INVALID_INPUT`).

- [ ] **Step 2:** Run `pnpm test:unit packages/contracts/test` and `direnv exec . cargo test -p opensekai-contracts`. Expected: the new tests fail.
- [ ] **Step 3:** Implement. Rust validation for `FaceKit`: `device_id.encode_utf16().count() <= 512`, message "invalid webcam config". The probe schema gets the two states too. In `tracking/mod.rs`, exclude `FaceKit` from the UDP reconcile filter with `Mediapipe`, and make `route_source` return `None` for it. Where `pnpm check` fails on the new union member, add the smallest branch that compiles (label "FaceKit Tracker"); Task 8 completes the editor.
- [ ] **Step 4:** Run `pnpm check`, `pnpm test:unit`, `direnv exec . cargo test --workspace --no-fail-fast`. Expected: pass, with the vectors green in `schema.test.ts` and `tests/vectors.rs`.
- [ ] **Step 5:** Commit: `Add the FaceKit tracking kind and states (TRK-24 B33)`.

### Task 3: Session rule and MCP text

**Files:**
- Modify: `packages/session/src/tracking.ts:69,122-123`, `apps/mcp/src/server.ts:7`
- Test: `packages/session/test/tracking-facekit.test.ts` (new), `packages/session/test/worker-lifecycle.test.ts`, `apps/mcp/test/facekit.integration.test.ts` (new)

**Interfaces:**
- Consumes: `FAILED_TRACKING_STATES` from Task 2.

- [ ] **Step 1: Write the failing tests.** Copy the `sample` and `fixture` helpers of `tracking-filter.test.ts:4-10` into the new file. `fixture` takes `'facekit'` and sets `avatar.tracking={bodySourceId:null,faceSourceId:'source'}`.

```ts
const status=(state:TrackingStatus['state'],error:string|null=null):TrackingStatus=>({sourceId:'source',generation:1,state,packets:1,invalidPackets:0,lastReceivedAtMs:null,error});
const state=(f:ReturnType<typeof fixture>,t:number)=>f.composer.evaluate(f.scene,t).trackingStatus[0].state;
it.each(['unavailable','permissionNeeded'] as const)('keeps %s and drops the sample as for error',failed=>{
 const f=fixture('facekit'),twin=fixture('facekit');
 for(const [g,s] of [[f,failed],[twin,'error']] as const){
  g.composer.ingest({samples:[sample('source',100,.8,'normalized')],statuses:[status('receiving')]},g.scene);
  expect(state(g,150)).toBe('receiving');
  g.composer.ingest({samples:[],statuses:[status(s,'reason')]},g.scene);
 }
 expect(state(f,160)).toBe(failed);
 expect(f.pose(160)).toEqual(twin.pose(160));
 f.composer.ingest({samples:[],statuses:[status('waiting')]},f.scene);
 expect(state(f,170)).toBe('waiting');
});
```

In `worker-lifecycle.test.ts`, add `'facekit'` to `trackedScene` and a test `accepts host FaceKit data and refuses local FaceKit data` by the pattern of the MediaPipe test at line 67: a clock update with a `facekit` sample reaches the composer; `ingestLocal` with the same sample changes nothing.

MCP (reason: the MCP to app protocol boundary), by the pattern of `calibration.integration.test.ts:34`: `scene_patch` with `createEntity` of a `facekit` tracking entity succeeds; `setAvatarTracking` with that source as `bodySourceId` fails with `INVALID_INPUT`; the `scene_patch` description contains "FaceKit".

- [ ] **Step 2:** Run `pnpm test:unit packages/session/test` and `direnv exec . pnpm test:integration`. Expected: the new tests fail. If the worker test passes at once, keep it: the filter at `worker.ts:77-82` already has the rule.
- [ ] **Step 3:** Implement. In `tracking.ts`, replace the `'error'` comparisons at lines 69, 122, and 123 with a membership check in `FAILED_TRACKING_STATES`. In `server.ts`, change the text to "adds a VMC, iFacialMocap, OpenSeeFace, MediaPipe, or FaceKit source (at most 4)" and "an iFacialMocap, OpenSeeFace, or FaceKit source can be only a face source", and add "A FaceKit source runs only on macOS; on another platform its state is unavailable."
- [ ] **Step 4:** Run `pnpm check`, `pnpm test:unit`, `direnv exec . pnpm test:integration`. Expected: pass.
- [ ] **Step 5:** Commit: `Keep the FaceKit failure states in the session and name the kind in MCP (TRK-24 B33)`.

### Task 4: Host mapping (Track H)

**Files:**
- Create: `apps/desktop/src-tauri/src/tracking/facekit/mod.rs`, `adapter.rs`, `mapping.rs` (tests in `mapping.rs`)
- Modify: `apps/desktop/src-tauri/src/tracking/mod.rs` (`pub mod facekit;`)

**Interfaces:**
- Produces (`adapter.rs`):

```rust
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraInfo { pub device_id: String, pub label: String }
#[derive(Clone, Debug, PartialEq)]
pub struct FaceFrame { pub blendshapes: [f32; 51], pub tongue_out: Option<f32>, pub rotation: [[f32; 3]; 3] }
#[derive(Clone, Debug, PartialEq)]
pub enum FaceEvent { Unavailable(String), PermissionNeeded, CameraFailed(String), Face { frame: FaceFrame, inference_ms: f64 }, NoFace }
pub type FaceSink = Arc<dyn Fn(FaceEvent) + Send + Sync>;
pub trait FaceAdapter: Send + Sync {
    fn cameras(&self) -> Vec<CameraInfo>;
    /// Returns at once. Progress and failures arrive through `sink`, possibly before `start` returns.
    /// Before a terminal event (`Unavailable`, `PermissionNeeded`, `CameraFailed`) the adapter stops the camera and releases the tracker.
    fn start(&self, device_id: &str, sink: FaceSink) -> Box<dyn FaceRun>;
}
/// Drop stops the capture and releases the tracker. It returns after the capture stopped.
pub trait FaceRun: Send {}
```

- Produces (`mapping.rs`):

```rust
pub const FACEKIT_NAMES: [&str; 51];                    // the Apple names, in the spec order
pub struct BadShape;
pub fn names_match(names: &[String]) -> bool;
pub fn arkit_name(name: &str) -> String;                // "_L" -> "Left", "_R" -> "Right"
pub fn face_frame(rotation: Option<&[Vec<f64>]>, blendshapes: Option<&[u8]>, tongue_out: Option<f64>) -> Result<Option<FaceFrame>, BadShape>;
pub fn head_rotation(rotation: &[[f32; 3]; 3]) -> Quat; // rows 2 and 3 negated, then a unit quaternion (x, y, z, w)
pub fn sample_parts(frame: &FaceFrame) -> Option<(TrackingBone, BTreeMap<String, f64>)>;
```

- [ ] **Step 1: Write the failing tests** in `mapping.rs`. A test helper `rotvec_deg(q: Quat) -> [f64; 3]` gives axis times angle in degrees.
  - `names_match_only_the_exact_list`: the exact list is true; items 0 and 1 swapped, 50 names, and 52 names are false.
  - `arkit_names_cover_the_contract_list`: `arkit_name("eyeBlink_L") == "eyeBlinkLeft"`, `arkit_name("mouthSmile_R") == "mouthSmileRight"`, `arkit_name("jawOpen") == "jawOpen"`; the 51 converted names plus `tongueOut` are equal as a set to `opensekai_contracts::ARKIT_NAMES`.
  - `face_frame_checks_the_shape`: `(None, None, None)` is `Ok(None)`; 204 bytes with value 0.5 at index 19 and a 3x3 rotation is `Ok(Some(_))` with `blendshapes[19] == 0.5`; 200 bytes, 208 bytes, a rotation of 2 rows, a row of 4 numbers, and a rotation with no blend shapes are each `Err(BadShape)`.
  - `head_rotation_matches_the_measured_rows`: for each of the five rows of spec Appendix B, `rotvec_deg(head_rotation(matrix))` is within 0.3 of the listed vector on each axis. The first row: `[[0.8462,-0.0219,0.5323],[-0.0012,-0.9992,-0.0391],[0.5328,0.0325,-0.8456]]` gives `[-2.2, 32.2, 0.7]`.
  - `camera_neutral_is_identity`: `[[1,0,0],[0,-1,0],[0,0,-1]]` gives `[0,0,0,1]` within 1e-6.
  - `sample_parts_clamps_and_rejects`: `-0.2` gives 0 and `1.4` gives 1; `tongue_out: Some(0.87)` gives `tongueOut` within 1e-6 of 0.87 and 52 expressions; `None` gives 51 expressions and no `tongueOut`; the bone has `space` normalized, no position, no weight; a NaN blend shape, a NaN tongue value, and an infinite rotation value each give `None`.
  - `fixture_frames_move_the_right_way`: read `fixtures/tracking/facekit-frames.json`. Each frame gives `Some`. Against the `neutral` frame: `head_down` X more than 8 higher; `tilt_right` Z more than 10 higher; `smile` `mouthSmileLeft` more than 0.3 higher; `tongue` `tongueOut` above 0.5; `blink_left` `eyeBlinkLeft` above `eyeBlinkRight`. If a row fails a limit, report it; do not lower the limit. (Controller ruling: the `head_left`, `head_right`, `tilt_left` and `jaw_open` rows of the fixture show the performer's transition, not the pose, so the test does not check them; `head_rotation_matches_the_measured_rows` covers the turn and tilt signs.)
- [ ] **Step 2:** Run `direnv exec . cargo test -p opensekai-desktop --lib facekit::mapping`. Expected: compile failure, then failing tests.
- [ ] **Step 3:** Implement. Read the bytes with `f32::from_ne_bytes`. A blend shape with no rotation, or the reverse, is `BadShape`. No `unwrap` on input.
- [ ] **Step 4:** Run the same command and `direnv exec . cargo clippy -p opensekai-desktop --all-targets`. Expected: pass, clean.
- [ ] **Step 5:** Commit: `Add the FaceKit output mapping (TRK-24 B33)`.

### Task 5: Session manager, stub, and snapshot merge (Track H)

**Files:**
- Create: `apps/desktop/src-tauri/src/tracking/facekit/stub.rs`
- Modify: `apps/desktop/src-tauri/src/tracking/facekit/mod.rs`, `apps/desktop/src-tauri/src/tracking/mod.rs`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: Task 4 types and `sample_parts`.
- Produces:

```rust
// facekit/mod.rs
pub fn platform_adapter() -> Arc<dyn FaceAdapter>;      // Task 5: the stub on each platform. Task 6: MacFaceAdapter on macOS.
pub struct FaceKitManager;
impl FaceKitManager {
    pub fn new(clock: Instant, adapter: Arc<dyn FaceAdapter>) -> Self;
    pub fn reconcile(&self, scene: &SceneView);          // one call for each new scene revision
    pub fn snapshot(&self, now_ms: f64) -> TrackingUpdate;
    pub fn shutdown(&self);
    pub fn cameras(&self) -> Vec<CameraInfo>;
}
// facekit/stub.rs, under cfg(any(not(target_os = "macos"), test)) as in capture/mod.rs
pub struct StubFaceAdapter;                              // start sends Unavailable("FaceKit needs macOS"); cameras is empty
// tracking/mod.rs
impl TrackingManager {
    pub fn with_face_adapter(clock: Instant, adapter: Arc<dyn FaceAdapter>) -> Self;   // new(clock) uses platform_adapter()
    pub fn face_cameras(&self) -> Vec<CameraInfo>;
}
```

Rules that the tests pin:
- Candidates for the session are the enabled `facekit` sources that did not fail. The holder keeps the session. With no holder, the first candidate in scene order starts. Each other candidate has `Error` with `format!("FaceKit used by {name}")`.
- Each start gets a new run token, set before `adapter.start`. The sink ignores an event with another token. Do not hold the manager lock across `adapter.start`: the stub calls the sink inside `start`.
- `Face`: `sample_parts` gives the sample (`received_at_ms` = `clock.elapsed()` in ms), `packets + 1`, `inference_ms`, `Receiving`. `None` from `sample_parts`, and `NoFace`: `invalid_packets + 1`.
- A terminal event sets `Unavailable` (with the reason), `PermissionNeeded` (no reason), or `Error` (with the reason), removes the sample, and marks the source failed. The sink never drops the run (a drop on the adapter's thread can deadlock). The next reconcile or the shutdown drops it.
- A failed source starts again only when its generation or config changes. A reconcile with no change for the holder keeps the run.
- `snapshot`: `Receiving` becomes `Stale` when `now_ms - last_received_at_ms > 500.`; the sample stays, as for a UDP source.

- [ ] **Step 1: Write the failing tests** in `facekit/mod.rs`. A `FakeAdapter` records each `(device_id, sink)` in `starts` and counts each run drop in `drops`. A helper builds a `SceneView` from `(id, name, generation, enabled, device_id)` rows and a revision.
  - `starts_one_run_for_an_enabled_source`: one start with the source `deviceId`; status `Waiting`, `packets` 0, no error. A disabled source: no start, status `Stopped`.
  - `face_event_gives_a_sample_and_receiving`: after one `Face { inference_ms: 5.0 }`: one sample with a `head` bone; `Receiving`, `packets` 1, `inference_ms` `Some(5.0)`. `snapshot(last_received_at_ms + 501.)` gives `Stale` with the sample. A second `Face` gives `Receiving`.
  - `no_face_and_bad_values_count_invalid`: two `NoFace` and one `Face` with a NaN value give `Waiting`, `invalid_packets` 3, no sample.
  - `terminal_events_end_the_run`: after a `Face`, each of `Unavailable("FaceKit library not found")`, `PermissionNeeded`, `CameraFailed("Camera stopped")` gives its state and reason and no sample; `drops` is 0 before and 1 after the next reconcile; `starts` stays 1.
  - `failed_source_retries_only_after_a_config_change`: after `Unavailable`, two more revisions with no change keep `starts` at 1 and the state `Unavailable`; disable then enable gives `starts` 2 and `Waiting`.
  - `unrelated_revision_keeps_the_run`: three revisions with the same source: `starts` 1, `drops` 0.
  - `camera_or_generation_change_restarts`: a new `deviceId` gives `drops` 1, a second start with the new ID, no sample, `packets` 0. The same for a new generation.
  - `disable_and_removal_stop_the_run`: disable gives `drops` 1, `Stopped`, no sample. Removal gives `drops` 1 and no status.
  - `old_run_events_are_ignored`: after a disable, the first sink sends `Face`: no sample, `Stopped`, `packets` 0. After a camera change, the first sink sends `Face` and `CameraFailed`: `Waiting`, `packets` 0, no error.
  - `second_source_is_an_error_and_takes_over`: A and B enabled: one start (A); B has `Error` "FaceKit used by A". B before A in scene order in the next revision: A keeps the run. A disabled: `drops` 1, a start with B's `deviceId`, B `Waiting` with no error.
  - `shutdown_drops_the_run`: `drops` 1; `snapshot` is empty; a later event changes nothing.
  - `stub_reports_unavailable`: with `StubFaceAdapter`, an enabled source has `Unavailable` and "FaceKit needs macOS"; `cameras()` is empty.
  - In `tracking/mod.rs` tests, `facekit_update_is_in_the_snapshot`: `TrackingManager::with_face_adapter` with one VMC source and one `facekit` source; after a `Face`, `snapshot()` has a status for each source and the `facekit` sample; `shutdown().await` drops the run.
- [ ] **Step 2:** Run `direnv exec . cargo test -p opensekai-desktop --lib tracking`. Expected: compile failure, then failing tests.
- [ ] **Step 3:** Implement. `TrackingManager` owns a `FaceKitManager`; `reconcile` calls it after the revision gate; `snapshot` appends its update; `shutdown` calls it.
- [ ] **Step 4:** In `ARCHITECTURE.md`, add FaceKit to the Host node, the `apps/desktop/src-tauri` row, and "Tracking path" step 1: the host session, the adapter boundary (all Apple code behind `FaceAdapter`; a stub that answers `unavailable` on each other platform; a mobile build keeps the stub), and that frames do not leave the host.
- [ ] **Step 5:** Run the Step 2 command, `direnv exec . cargo test --workspace --no-fail-fast`, and clippy. Expected: pass, clean.
- [ ] **Step 6:** Commit: `Add the FaceKit session manager and stub adapter (TRK-24 B33)`.

### Task 6: macOS adapter (Track H)

**Files:**
- Create: `apps/desktop/src-tauri/src/tracking/facekit/macos.rs`, `apps/desktop/src-tauri/tests/facekit_integration.rs`, `apps/desktop/src-tauri/examples/facekit_smoke.rs`
- Modify: `apps/desktop/src-tauri/src/tracking/facekit/mod.rs`, `apps/desktop/src-tauri/Cargo.toml:51-62`, `Cargo.lock`, `apps/desktop/src-tauri/Info.plist:4-5`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `FaceAdapter`, `FaceRun`, `FaceEvent`, `names_match`, `face_frame`.
- Produces (macOS only, re-exported from `facekit/mod.rs`):

```rust
pub struct MacFaceAdapter;                               // impl FaceAdapter; MacFaceAdapter::new()
pub struct FaceKitProbe { pub api_version: u32, pub names: Vec<String> }
pub fn probe() -> Result<FaceKitProbe, String>;          // the library path, or OPENSEKAI_FACEKIT_LIBRARY in a debug build
pub fn probe_at(path: &str) -> Result<FaceKitProbe, String>;   // dlopen, dlsym x4, version, names, Create, release
```

- [ ] **Step 1: Write the failing integration test** (reason: AppleCVA is a real system boundary; no camera is necessary).

```rust
#[test]
#[cfg_attr(not(target_os = "macos"), ignore = "FaceKit needs macOS")]
fn loads_applecva_and_creates_a_tracker() {
    #[cfg(target_os = "macos")]
    {
        use opensekai_desktop_lib::tracking::facekit::{mapping::FACEKIT_NAMES, probe, probe_at};
        let found = probe().expect("FaceKit start-up check");
        assert!(found.api_version > 0);
        assert_eq!(found.names, FACEKIT_NAMES);
        println!("FaceKit API version {}", found.api_version);
        assert_eq!(probe_at("/System/Library/PrivateFrameworks/Missing.framework/Missing").err().as_deref(), Some("FaceKit library not found"));
    }
}
```

- [ ] **Step 2:** Run `direnv exec . cargo test -p opensekai-desktop --test facekit_integration -- --nocapture`. Expected: compile failure.
- [ ] **Step 3:** Add `objc2-av-foundation = "=0.3.2"` and `objc2-vision = "=0.3.2"` to the macOS dependencies. Implement `macos.rs` from spec Appendix A, in the style of `capture/macos.rs` (file comment with the APIs and threads; a reason on each `unsafe` block).
  - Start, on a thread of the adapter: (1) `dlopen` and `dlsym`: "FaceKit library not found"; (2) `CopySemantics` and `names_match`: "FaceKit output names changed"; (3) camera authorization: not determined asks and continues in the completion handler, denied or restricted sends `PermissionNeeded`; (4) `Create`: "FaceKit tracker did not start"; (5) the device by unique ID, or the system default for `''`: "Camera not found"; session, input, `420f` output with late frames discarded on a serial queue: "Camera cannot start". The spike called `Create` before `CopySemantics`. If `CopySemantics` fails before `Create`, change the order of (2) and (4) and record it in the analysis.
  - Write the API version to the host log at each start.
  - For each frame, on the capture queue: Vision face rectangle, the input dictionary of Appendix A, `Process`. In the callback, copy only `tracked_faces[0].raw_data.pose.rotation`, `raw_data.animation.blendshapes`, and `tongue_out` (from `raw_data.animation`, else `smooth_data.animation`), and call `face_frame`: `Ok(Some)` sends `Face` with the time since `Process`; `Ok(None)` or no face sends `NoFace`; `Err` stops the run and sends `Unavailable("Unexpected FaceKit output")`.
  - A session runtime error or a device disconnect stops the run and sends `CameraFailed("Camera stopped")`.
  - `Drop` of the run: set a cancel flag; stop the capture; wait for the capture queue; release the tracker. A start in progress reads the flag after each step and releases what it made.
  - `cameras()`: `AVCaptureDeviceDiscoverySession` (built-in wide angle, external, Continuity Camera), unique ID and localized name.
  - `platform_adapter()` gives `MacFaceAdapter` on macOS.
- [ ] **Step 4:** Write `examples/facekit_smoke.rs`: `--seconds <n>` (default 10), `--device <id>`, `--stop-after-ms <n>`. It prints the camera list, starts `platform_adapter()`, prints one line each second (`faces`, `no_face`, last `inference_ms`) and each terminal event, drops the run at the end or at `--stop-after-ms`, then waits 2 s and prints the event count after the drop. Change the `Info.plist` text to the plan value.
- [ ] **Step 5:** Run the Step 2 command. Expected: PASS, with the API version in the output. Run `direnv exec . cargo test --workspace --no-fail-fast` and clippy. Expected: pass, clean.
- [ ] **Step 6:** Commit: `Add the macOS FaceKit adapter (TRK-24 B33)`.
- [ ] **Step 7 (integrator, with the owner's consent; the builder agent cannot get camera access):** start the smoke example from Terminal.app through a `.command` file. Run 1: `--seconds 10` with the owner at the camera: `faces` rises, the camera indicator goes off at the end, 0 events after the drop. Run 2: `--stop-after-ms 200`: 0 `Face` events after the drop and the indicator stays off (Review Focus 5). Run 3: `OPENSEKAI_FACEKIT_LIBRARY=/missing`: "FaceKit library not found" and no camera prompt.

### Task 7: Host commands (Track H)

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs:170-211,581-594,641`, `build.rs:33-52`, `capabilities/main.json`, `bootstrap.rs:252`, `service/mod.rs:938`, `ARCHITECTURE.md`

**Interfaces:**
- Consumes: `TrackingManager::face_cameras()`.
- Produces: Tauri commands `facekit_camera_list() -> Result<Vec<CameraInfo>, AppError>` (JSON `[{deviceId,label}]`) and `open_camera_settings() -> Result<(), AppError>`, both with `require_window_label(window.label(), "main")`.

- [ ] **Step 1:** Add `allow-facekit-camera-list` and `allow-open-camera-settings` to the expected list in the test `main_capability_has_the_exact_permission_list`. Run `direnv exec . cargo test -p opensekai-desktop --lib main_capability`. Expected: FAIL.
- [ ] **Step 2:** Implement by the pattern of `capture_source_list` and `open_capture_settings`: the service and bootstrap pass-through, the two commands, `generate_handler!`, the `build.rs` command list, and `capabilities/main.json`. `open_camera_settings` opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Camera`; on another platform it returns `ErrorCode::Unavailable` "Settings unavailable".
- [ ] **Step 3:** Add the two commands to the command and trust text of `ARCHITECTURE.md`.
- [ ] **Step 4:** Run `direnv exec . cargo test --workspace --no-fail-fast` and clippy. Expected: pass, clean.
- [ ] **Step 5:** Commit: `Add the camera list and camera settings commands (TRK-24 B33)`.

### Task 8: Editor (Track E)

**Files:**
- Create: `apps/desktop/src/editor/facekit.ts`, `apps/desktop/src/editor/add-menu.ts`
- Modify: `apps/desktop/src/editor/authoring.ts:20`, `asset-groups.ts:3`, `live-fields.ts:55-59`, `property-defaults.ts:18-19,66`, `apps/desktop/src/tracking/hidden-cameras.ts`
- Modify: `apps/desktop/src/components/Hierarchy.svelte:64`, `Inspector.svelte:140-143`, `TrackingSourceFields.svelte`, `TrackingDiagnostics.svelte`, `apps/desktop/src/EditorApp.svelte:61`
- Test: `apps/desktop/test/facekit.test.ts` (new), `add-menu.test.ts` (new), `hidden-cameras.test.ts`, `authoring.test.ts`, `asset-groups.test.ts`, `live-fields.test.ts`, `property-defaults.test.ts`

**Interfaces:**
- Consumes: commands `facekit_camera_list` and `open_camera_settings` (names only); `FAILED_TRACKING_STATES`.
- Produces:

```ts
// editor/facekit.ts
export interface FaceKitCommands {list:()=>Promise<unknown>;openSettings:()=>Promise<void>}
export const parseCameraList=(value:unknown):CameraDevice[]            // keeps {deviceId:string (1..512), label:string}; else drops the entry
export const trackingStateLabel=(state:TrackingStatus['state']):string // 'permissionNeeded' -> 'permission needed'; each other state unchanged
// editor/add-menu.ts
export const addMenuItems=(platform:string):[AddKind,string][]         // the list of Hierarchy.svelte:64; 'facekit' last, only when isMac(platform)
// tracking/hidden-cameras.ts
export const cameraOptions=(devices:readonly CameraDevice[],hidden:readonly string[],selectedId:string):{value:string;label:string}[]
```

- [ ] **Step 1: Write the failing tests.**

```ts
it('parses the host camera list',()=>{
 expect(parseCameraList([{deviceId:'a',label:'FaceTime HD Camera'},{deviceId:1,label:'x'},null,{deviceId:'b'.repeat(513),label:'y'},{deviceId:'',label:'z'}])).toEqual([{deviceId:'a',label:'FaceTime HD Camera'}]);
 expect(parseCameraList({})).toEqual([]);
});
it('labels the permission state',()=>{expect(trackingStateLabel('permissionNeeded')).toBe('permission needed');expect(trackingStateLabel('stale')).toBe('stale');});
it('shows FaceKit only on macOS',()=>{
 expect(addMenuItems('MacIntel').at(-1)).toEqual(['facekit','FaceKit Tracker']);
 for(const platform of ['Win32','Linux x86_64',''])expect(addMenuItems(platform).some(([kind])=>kind==='facekit')).toBe(false);
 expect(addMenuItems('MacIntel').slice(0,-1)).toEqual(addMenuItems('Win32'));
});
it('keeps the saved camera in the options',()=>{
 const devices=[{deviceId:'a',label:'FaceTime HD Camera'},{deviceId:'b',label:'OBS Virtual Camera'}];
 expect(cameraOptions(devices,['b'],'')).toEqual([{value:'',label:'Default camera'},{value:'a',label:'FaceTime HD Camera'}]);
 expect(cameraOptions(devices,['b'],'b').map(o=>o.value)).toEqual(['','a','b']);
 expect(cameraOptions(devices,[],'gone').at(-1)).toEqual({value:'gone',label:'Unavailable camera'});
 expect(cameraOptions([],[],'gone')).toEqual([{value:'',label:'Default camera'},{value:'gone',label:'Unavailable camera'}]);
});
```

  In the existing test files: `makeAuthoringEntity('facekit','id',[])` has the name "FaceKit Tracker" and the config `{kind:'facekit',enabled:false,deviceId:''}`; `addLimitReached('facekit',entities)` is true with 4 tracking entities of mixed kinds and false with 3; a `facekit` entity is in the group "FaceKit Trackers"; `parseTrackingConfig(config,{bindAddress:'',port:'',address:''})` returns a `facekit` config unchanged and `initialTrackingDraft` gives three empty strings; the field IDs of a `facekit` source have no `bindAddress`, `port`, `address`, `face`, `upperBody`, `hands`, or `mirror`, and have the smoothing and mapping IDs of `openseeface`.
- [ ] **Step 2:** Run `pnpm test:unit apps/desktop/test`. Expected: the new tests fail.
- [ ] **Step 3:** Implement the pure functions. `cameraOptions` is the option list that `TrackingSourceFields.svelte` builds inline today (`hidden` holds the same values that `visibleCameras` takes); the MediaPipe select uses it too.
- [ ] **Step 4:** Implement the UI.
  - `Hierarchy.svelte`: the list comes from `addMenuItems(currentPlatform())`.
  - `EditorApp.svelte`: `const faceKitCommands:FaceKitCommands={list:()=>invoke<unknown>('facekit_camera_list'),openSettings:()=>invoke<void>('open_camera_settings')};`, passed through `Inspector.svelte` to `TrackingSourceFields` as the prop `faceKit`.
  - `TrackingSourceFields.svelte`, for `facekit`: load the camera list with `faceKit.list()` when the entity shows (a failure gives an empty list); the Camera `Select` with `cameraOptions(list, hiddenCameras.state.hidden, config.deviceId)` and **Apply**; `hiddenCameras.setDevices` gets this list, and the "Hidden cameras" block shows as for `mediapipe`; no channel checkboxes and no address fields; under the select, `<p>Uses a private macOS API. It can stop after a macOS update.</p>`. The state text uses `trackingStateLabel`. The alert shows `status.error` when the state is in `FAILED_TRACKING_STATES` and the error is not null. For `permissionNeeded`, a secondary `Button` "Open Settings" calls `faceKit.openSettings` (pattern: `ScreenCaptureFields.svelte:20`). Calibrate and Reset work as for `openseeface`.
  - `TrackingDiagnostics.svelte`: the Inference row shows for `mediapipe` and `facekit`; the State row uses `trackingStateLabel`.
- [ ] **Step 5:** Run `pnpm check` and `pnpm test:unit`. Expected: pass. The running flow is checked in Task 9.
- [ ] **Step 6:** Commit: `Add the FaceKit source to the editor (TRK-24 B33)`.

### Task 9: Integration, live verification, and records

**Files:**
- Create: `docs/evaluation/facekit-tracking.md`
- Modify: `docs/warudo-parity.md` (new row TRK-24 after TRK-23), `docs/testing.md` (baseline table), `ARCHITECTURE.md` (if a line is false after the merge), the analysis ("Implementation findings")

- [ ] **Step 1:** Merge Track H and Track E into the feature branch. Run `direnv exec . cargo clean -p opensekai-desktop -p opensekai-contracts`, then `pnpm check`, `pnpm test:unit`, `direnv exec . pnpm test:integration`, `direnv exec . cargo test --workspace --no-fail-fast`, `direnv exec . cargo clippy --workspace --all-targets`. Keep the raw output with the counts.
- [ ] **Step 2:** Ask a reviewer on a different model for defects against R1 to R23 and the safeguards of the contract. Correct each confirmed defect with a test.
- [ ] **Step 3: Linux.** Run the `docs/testing.md` baseline in a Linux container or a cloud run (`bash scripts/cloud-setup.sh`). Expected: the same results as the baseline, plus one ignored test ("FaceKit needs macOS"). If no Linux host is available, the record says "unknown". Windows is "unknown".
- [ ] **Step 4: Live checks** on the owner's Mac. Ask the owner first; the owner must be at the camera. Check `pgrep -fl opensekai` first. Build from this worktree and start `pnpm dev:desktop` from Terminal.app through a `.command` file. Use the Catboy ARKit VRM. For each check, record pass, fail, or unknown.
  1. Add "FaceKit Tracker", set it as the face source, Start: `receiving`; the diagnostics show packets and the inference time.
  2. Output: head left, right, up, down, each tilt; each eye blink on the correct side; jaw; smile; tongue.
  3. Calibrate, Reset, smoothing, and one face mapping range change the avatar as for another source.
  4. Stop, Start, a camera change, a switch of the face source to MediaPipe and back, to a UDP source and back, source removal, and app quit: the camera indicator goes off at each stop and no old pose stays.
  5. Cover the camera: `stale`. Uncover: `receiving`.
  6. A second enabled FaceKit source: "FaceKit used by …". Stop the first: the second gets `receiving`.
  7. MediaPipe and FaceKit on the same camera at the same time: record the result.
  8. Unavailable: start the dev build with `OPENSEKAI_FACEKIT_LIBRARY=/missing`: `unavailable` with the reason, no camera prompt, no other tracker starts.
  9. Permission: build the bundle (`direnv exec . pnpm build:mac`), start it with `open <bundle path>`, confirm the binary path with `pgrep -fl OpenSekai.app`. Deny the prompt: `permission needed` and **Open Settings** opens the Camera pane. Grant, then Stop and Start: `receiving`. The release build does not read the override: with the variable set, the source still runs.
  10. OBS: the transparent output shows the tracked face. Minimize the editor: the motion continues. Use an isolated OpenSekai test source in OBS; do not start a stream.
  11. Measure as observed, with no pass limit: sample rate from the packet rate, inference time, and CPU of the host process over 60 s.
- [ ] **Step 5:** Write `docs/evaluation/facekit-tracking.md`: commit, Mac model, macOS version, camera, AppleCVA version, API version, renderer backend, quality profile, avatar revision, the result of each check, the test counts of Step 1, the platform table (macOS, Linux, Windows), and each gap (Intel, other macOS versions, external and virtual cameras, notarized build, more than one face, the stop of the identity computation). App timing and OBS timing stay separate.
- [ ] **Step 6:** Add the TRK-24 row to `docs/warudo-parity.md` in the style of TRK-08. Claim only the checks that passed on the tested Mac, and link the two records. Update the `docs/testing.md` baseline for the new ignored test. Add the implementation findings to the analysis.
- [ ] **Step 7:** Commit: `Record the FaceKit verification (TRK-24 B33)`. Run `direnv exec . cargo sweep --time 7`.
- [ ] **Step 8:** Push the branch and open a pull request for #260. The text follows ASD-STE100, has no agent credit, gives the test plan, and lists the checks of Step 4 that the owner must repeat under **Local acceptance**.
