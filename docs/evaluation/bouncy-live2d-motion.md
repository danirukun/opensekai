# Bouncy Live2D motion check

Date: pending. Scope: VPoyo gap 2 ([#294](https://github.com/danirukun/opensekai/issues/294)). Contract: [bouncy Live2D motion](../../spdd/prompt/2026-11-21-bouncy-live2d-motion.md). Design: [bouncy Live2D motion design](../superpowers/specs/2026-11-21-bouncy-live2d-motion-design.md).

Status: attempted and blocked on 2026-11-21 at commit `7e0b3005`. No result is verified. The code is in the Face-Only Body Motion template, and the bounce is off by default.

## Attempt log (2026-11-21, commit `7e0b3005`)

The check needs `OPENSEKAI_EVALUATION=1 pnpm dev:desktop` to reach a ready app, then a face-only tracking source, the Face-Only Body Motion template, and an OBS browser source on `output_main`. The macOS test machine runs this app from one global state folder (`~/Library/Application Support/com.oshi-connect.opensekai`) shared by every worktree and every agent on the box, and one fixed dev port (`1420`). Both are set once for the whole machine, not once for each worktree.

During this attempt, a second agent in another worktree (`.claude/worktrees/agent-a9aa8e8ffb43572fc`) held the dev app and port `1420` at the same time. The local QA skill allows quitting a conflicting instance, so that instance was stopped to free the port, and this agent's own `pnpm dev:desktop` ran after that.

The app then started (frontend build, Rust compile, and process launch all finished), but the app never reached `ready: true` in six separate launches, each left running for 3 to 6.5 minutes. `app_status` stayed at `revision: 0` (the smoke scene with only the camera and three lights; the test avatar and stage props had not committed yet). A process sample during three of the stalls showed the same hot path each time: `opensekai_desktop_lib::service::connection_loop` and `write_connection` spending most of their time inside `serde_json::Value` serialize, deserialize, and `BTreeMap` drop code, next to `opensekai_contracts::scalar_checks`, `shape`, and `SceneEntity::serialize`. The shared asset folder on this machine had grown to about 1 GB with 45 asset records at the time of the attempt (shared across every agent's OpenSekai runs on this box, not only this task's). This matches a JSON validation cost on the WS connection loop that grows with the shared state the app finds on that machine, not a defect tied to the bounce feature's code.

One app instance (crashed after about 6.5 minutes of normal ticking, no panic line in its log) and another refused a port already in use; both point at the same root cause: the test machine was running more agents and more OpenSekai copies than its one shared app-support folder and one fixed port can serve at once.

No OBS frame, no screenshot, and no pose value in this attempt is evidence of the bounce feature itself. None of the six checks below moved past "not verified" because the app never finished loading a scene to look at.

Next attempt: run on a machine or a time slot with no other agent driving `~/Library/Application Support/com.oshi-connect.opensekai`, or point `OPENSEKAI_EVALUATION` runs at a per-run state folder if the app grows that option. Prefer the public `fixture_vrm_1` avatar over the heavier private ARKit fixture to cut asset size, and use the iFacialMocap text protocol (`=head#<rx>,0,0,0,0,0|jawOpen&<0-100>|` to UDP port 49983) to drive pitch and jaw without a camera or phone, confirmed from `apps/desktop/src-tauri/src/tracking/parser.rs` test cases.

Record for each run: commit, platform, backend, quality profile (`production_v1` for OBS), OBS video size and FPS, avatar asset ID, and the tracking source. Keep app timing and OBS timing separate. A value that was not measured is unknown, not zero.

## Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Face-only character, `Bouncy Motion` off: no bounce translation and no bounce scale in the pose | | |
| 2 | `Bouncy Motion` on: the upper body sinks when the chin drops, and rises when the chin comes up | | |
| 3 | OBS at 60 FPS: no visible jitter in the bounce | | |
| 4 | Editor minimized: the OBS bounce continues | | |
| 5 | A body source on the character: the bounce writers skip the covered bones | | |
| 6 | VMC send: the translation is on the wire, and the scale is not (known difference) | | |

## Not verified

Everything above.
