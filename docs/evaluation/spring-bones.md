# Spring bones check

Date: 2026-11-18. Scope: CHR-08 first subset ([#14](https://github.com/danirukun/opensekai/issues/14)). Contract: [spring bones](../../spdd/prompt/2026-11-18-spring-bones.md). Design: [spring bones design](../superpowers/specs/2026-11-18-spring-bones-design.md), local acceptance checks 1 to 5.

Platform: macOS 27.2.1 (26B131), Apple M3 Pro, 36 GB memory, AC power. OBS 33.0.1 with obs-websocket 5.7.6, OBS video 1920 × 1080 at 60 FPS. The app is `pnpm dev:desktop` with `OPENSEKAI_EVALUATION=1` (a debug host and the Vite renderer pages), so all timings in this file are debug results. Commit: `1ecd797`. Backend: WebGPU for both renderers. Quality profiles: `production_v1` for `output_main` (the OBS Browser Source), `preview_v1` for `preview_main` (the scene pane).

Avatars, from the shared asset library:

| Avatar | Asset ID | Spring data |
| --- | --- | --- |
| Roro (`RORO_vrm_arkit_02`, VRM 0.x, the newest Roro import) | `avatar_e129ba50…` | 10 chains, 30 joints, 3 colliders, no center node |
| Catboy with black hoodie (VRM 0.x) | `avatar_7b7c689e…` | 20 chains, 56 joints, 22 colliders, center node "Root" |

The design names `avatar_c116520b…` as an example Roro import with 30 joints. `avatar_e129ba50…` is a later import of the same model with the same spring layout. Both avatars load with no load warning.

Scene: Roro at x = −0.36 m, Catboy at x = 0.54 m, scale 1, idle animation off. `camera_main` at (0.09, 1.3, 1.5). Each avatar has its own VMC receiver (ports 39541 and 39542, positions `rotationsOnly`). [`motion-feed.mjs`](spring-bones/motion-feed.mjs) sends a VMC wave on the hips, spine, and head at 60 Hz (or a step: a still pose for 2 s, then a head turn of 30° and a spine roll of 10°). This is generated motion, not a camera tracker.

OBS: an isolated QA scene with one Browser Source on the `output_main` page. [`obs-frames.mjs`](spring-bones/obs-frames.mjs) reads that source with `GetSourceScreenshot` at 960 × 540, about 21 frames each second. It changes no OBS setting and does not record or stream. A changed pixel below is a pixel whose RGBA value changes by more than 8 between two read frames.

## Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Editor with tracking: hair and accessories move with head and body motion | Pass | Below |
| 2 | OBS at the 60 and 30 FPS output limit: same motion, correct alpha around the hair | Pass (alpha, motion); Needs owner (the feel of 30 against 60) | Below |
| 3 | Editor minimized: the OBS hair keeps its motion | Pass | Below |
| 4 | Move 0.3 m and 2 m, turn 45°, scale 1 to 1.5: no whip or flip; gizmo drag fast and slow | Pass (Inspector values); Needs owner (the feel of a fast drag) | Below |
| 5 | Renderer CPU time with and without spring bones, 1 and 2 avatars | Measured (debug build): about +0.6 ms mean with 2 avatars, about +0.3 ms with 1 avatar. The target for 3 avatars is not checked | Below |

### 1. Editor with tracking

With the wave feed, the hair, the hair buns, the side strands, and Catboy's ears and fringe move with the head and body in the scene pane and in OBS ([scene pane](spring-bones/editor-scene-frame.png), [OBS frames](spring-bones/motion-grid.png)). The PR has a clip of the scene pane.

Spring motion alone, without body motion:

- Roro, no tracking and no idle, moved by 0.09 m (under the teleport limit): 0 changed pixels before the move. After it: 2312, 2120, 1315 changed pixels, to 0 after about 2.3 s, only in the hair area ([mask](spring-bones/spring-settle-mask.png), [frames](spring-bones/spring-settle-strip.png)).
- Catboy, with the step feed: the head is fully turned after 861 ms. The side strands swing out and are still after about 960 ms ([frames](spring-bones/catboy-step-strip.png)).

Catboy does not move its hair when only the entity moves. Its bone groups use the center node "Root", so three-vrm simulates them in the space of that node. That is the authored VRM 0.x behavior. Roro has no center node.

### 2. OBS at 60 and 30 FPS

The renderer FPS counter in the OBS source shows 60 FPS and then 30 FPS after `setOutputFormat` ([counter](spring-bones/fps-counter-60-30.png)).

| Output limit | Read frames | Frames equal to the previous frame | Mean changed pixels | Alpha 0 | Partial alpha |
| --- | --- | --- | --- | --- | --- |
| 60 FPS | 248 in 12 s | 0 | 65,367 | 58.9 % | 0.83 % |
| 30 FPS | 262 in 12 s | 0 | 63,123 | 58.0 % | 0.86 % |

Both outputs change on each read frame and give the same amount of motion ([60 against 30](spring-bones/obs-60-vs-30.png)). The read rate (about 21 FPS) is lower than both limits, so this method cannot compare the smoothness of 30 and 60 FPS. The PR has both clips for the owner. On a checker, the hair edge has no dark fringe and no opaque background ([hair on a checker](spring-bones/obs-hair-alpha-checker.png)). The spring steps stay on the session grid at each output limit; the unit test "every second frame stays within 1° mean" covers the 30 FPS case.

### 3. Editor minimized

The editor window was minimized (`AXMinimized` true). With the wave feed, all 275 frames read in 12 s were different. Then the feed stopped, and Roro moved by 0.09 m while the window stayed minimized: 0 changed pixels before the move. After it: 10,449 changed pixels, to 0 after about 1.3 s, only on the hair and the hair shadow on the face ([mask](spring-bones/minimized-spring-mask.png)).

### 4. Teleport, turn, and scale

Each change is one `setTransform` patch (the command that the Inspector sends) with no body motion. One move typed into the Inspector X field gives the same result. Each change goes above a teleport limit (0.1 m, 30°, scale ratio 1.25), so the springs reset.

| Change | Largest change after it | Still after | Hair |
| --- | --- | --- | --- |
| Move 0.3 m on x | 1,787 px | about 0.75 s | No whip or flip ([frames](spring-bones/teleport-03m-strip.png)) |
| Move 2 m on z (away from the camera) | 357 px | about 0.7 s | No whip or flip ([frames](spring-bones/teleport-2m-strip.png)) |
| Turn 45° | 1,723 px | about 0.75 s | No whip or flip ([frames](spring-bones/turn-45-strip.png)) |
| Scale 1 to 1.5 (at z = −4 m, so that the head stays in the frame) | 330 px | about 0.6 s | No whip or flip ([frames](spring-bones/scale-15-strip.png)) |
| Inspector X from −0.36 to 0.04 (0.4 m) | 2,317 px | about 0.9 s | No whip or flip |

After a reset, the hair starts from its rest pose and settles under gravity. That is the small change after each row.

Gizmo drag on the x arrow (Quartz mouse events, 120 events each second). The drag sends one patch for each pointer move (73 revisions for the two drags):

- Slow, 0.47 m in 2.4 s (about 0.2 m/s): the hair trails a little. The white front strand moves toward the eye during the drag and is still about 0.8 s after the release ([frames](spring-bones/drag-slow-head.png)).
- Fast, 0.47 m in 0.24 s (about 2 m/s, about 0.03 m for each step, under the 0.1 m limit, so no reset): the white front strand swings across the face for about 0.1 s, then goes back. The hair is still about 0.8 s after the release ([frames](spring-bones/drag-fast-head.png)). No bone turns over. This is the lag of real fast motion, not a teleport effect. Whether this much swing is good is a judgment for the owner.

`TELEPORT_LIMITS` stays the same. A move limit small enough to reset the fast drag (0.03 m for each step) is in the range of normal tracked hip motion.

`springResets` is not in `app_status`, so this check cannot see it in the frames. The session tests (`packages/session/test/spring-resets.test.ts`) and the contract tests (`packages/contracts/test/spring-resets.test.ts`, `crates/contracts/tests/spring_resets.rs`) cover it.

### 5. Renderer CPU time

Value: `FrameApplied.cpuMs` of `output_main`, the renderer CPU time to apply one frame (the spring steps are in it). [`cost-sample.mjs`](spring-bones/cost-sample.mjs) reads it from `app_status` each 100 ms, so a 120 s window has about 1,120 of the about 7,200 frames. The resolution of `cpuMs` is 0.1 ms. GPU time: unknown (`gpuMs` is not reported). `benchmark_start` supports only the `smoke_v1` fixture, so it cannot measure this scene.

Builds: this branch (`1ecd797`) and `a8434a2`, the parent of the first code commit, where the loader disables spring bones. Both are debug builds with the same scene, the same wave feed on the two receivers, the editor window at 1440 × 900, the OBS QA scene on program, and `caffeinate`. For 1 avatar, Catboy is removed and Roro stays.

Each run has a 30 s warmup and then 3 windows of 120 s, one after the other. The run order is branch 2, branch 1, baseline 2, baseline 1, branch 2, branch 1. The branch runs two times, so a drift over time shows.

| Build | Avatars | Run | Mean of each window (ms) | p95 of each window (ms) |
| --- | --- | --- | --- | --- |
| Branch | 2 | 1 | 4.990, 4.931, 5.019 | 5.7, 5.8, 5.8 |
| Branch | 2 | 2 | 5.031, 4.802, 4.962 | 5.8, 5.8, 5.6 |
| Baseline | 2 | 1 | 4.490, 4.405, 4.150 | 4.9, 4.8, 4.9 |
| Branch | 1 | 1 | 2.572, 2.378, 2.512 | 3.8, 3.6, 3.6 |
| Branch | 1 | 2 | 2.519, 2.481, 2.389 | 3.7, 3.6, 3.6 |
| Baseline | 1 | 1 | 2.361, 2.201, 2.032 | 3.3, 3.1, 3.1 |

- 2 avatars (86 joints, 25 colliders): the branch mean is 4.96 ms (6 windows) and the baseline mean is 4.35 ms (3 windows), a difference of +0.61 ms. The p95 difference is about +0.9 ms. Each branch window is higher than each baseline window, and the difference is larger than the spread in one condition (0.34 ms at most). This is a real cost.
- 1 avatar (Roro, 30 joints, 3 colliders): the branch mean is 2.48 ms and the baseline mean is 2.20 ms, a difference of +0.27 ms. That is smaller than the spread of the baseline windows (0.33 ms), and the lowest branch window (2.378) is only a little higher than the highest baseline window (2.361). The mean difference is at the edge of the noise. The p95 difference (3.6 to 3.8 against 3.1 to 3.3) is outside the noise.
- The baseline windows go down in each run (4.49 to 4.15, 2.36 to 2.03). The branch windows do not. The cause is unknown.

The design target is 1 ms or less for each renderer for each 60 Hz step with 3 heavy avatars. This check did not use 3 avatars, a release build, or the `preview_main` renderer (it also runs the springs), so the target is not checked. With 2 avatars in a debug build, the increase is 0.61 ms. This is an open risk: a linear estimate from these values for 3 heavy avatars can be more than 1 ms. A scene accepts at most 2 avatars (`packages/contracts/src/schema.ts`), so the app cannot run 3. The largest case that the app can measure is 2 heavy avatars: Xiulang Long and Nina have about 637 joints and 17,000 collision checks, about 90 % of the collision checks of the 3 heavy avatars in the design. Measure that case in a release build, in both renderers, before the target is used. The only 3-avatar value is the solver-only benchmark in [research](spring-bones/research/README.md).

OBS timing, kept separate: in each run OBS rendered 23,447 to 23,462 frames and skipped 0 frames for rendering. [`cost-runs.jsonl`](spring-bones/cost-runs.jsonl) has one line for each window and one OBS line for each run.

## Not verified

- Camera tracking. All motion came from the generated VMC feed.
- Tracked root positions against the teleport limits. The feed sent rotations only.
- A release build, Windows, a phone, and a low-end Mac.
- The cost with heavy avatars, the cost in a release build, the cost in `preview_main`, and GPU time. The app cannot run 3 avatars.
- A file that uses `VRMC_springBone_limit` (unit test only).
- Visual difference between renderers in a long session with real tracking noise.
