# Warudo feature parity checklist

Baseline reviewed: 2026-10-02. Source: [Warudo handbook](https://docs.warudo.app/docs).

Goal: broad functional parity, including documented Pro production features. OpenSekai uses a different engine and extension API. Unity pipeline internals, C# plugin binaries, bundled commercial content, and .warudo archive compatibility are not implied.

This is an initial handbook-category inventory. Reviewed feature pages inform the entries below. It is not a completed audit of every setting, built-in node, tutorial, or Pro-only restriction. Expand each category into tested behaviors before claiming full parity for it. Check a box only for its stated verified scope. Broad items remain unchecked until their complete behavior is verified. A desktop shell alone does not establish a production feature.

## Status and evidence rules

| Status | Meaning |
| --- | --- |
| First | Part of the first useful macOS foundation |
| Later | Required for the longer-term parity goal |
| Approximate | Planned behavior or appearance can differ; record the difference |
| Deferred | Explicitly outside current scope |
| Different API | Equivalent capability through the OpenSekai API |

An unchecked box means not verified. A checked box requires an evidence row with the commit, feature scope, platform, renderer backend, test or capture, and remaining gaps. Do not use a macOS check to claim Windows support. Do not count partial or approximate behavior as full coverage. Split a large item when only part is ready.

During implementation, update this file in the same checkpoint as the feature. Recheck the source page when the feature starts. Add new handbook items rather than silently reducing scope.

## Scene and asset management

Source: [Assets overview](https://docs.warudo.app/docs/assets/overview).

- [ ] SCN-01 — Create, remove, duplicate, and rename scene entities. First.
- [ ] SCN-02 — Groups, hierarchy, references, and property inspection. First.
- [ ] SCN-03 — Asset export/import and copy between shows. Later.
- [ ] SCN-04 — Merge imported settings into a selected entity. Later.
- [ ] SCN-05 — Save/load shows and preserve missing references. First; OpenSekai persistence requirement.
- [ ] SCN-06 — Portable prepared packages and migration diagnostics. First; OpenSekai persistence requirement.

## Characters and performance control

Source: [Character](https://docs.warudo.app/docs/assets/character).

- [ ] CHR-01 — VRM import and humanoid rig validation. First.
- [ ] CHR-02 — Prepared custom character packages. Later; Different API.
- [ ] CHR-03 — Expressions, expression blending, and triggers. First for tracking; full controls Later.
- [ ] CHR-04 — Idle animation and override clips. Later.
- [ ] CHR-05 — Animation layers, masks, transitions, and one-shot playback. Later.
- [ ] CHR-06 — Manual posing, IK, and look-at. Later.
- [ ] CHR-07 — Bone attachment points and visibility/material control. Later.
- [ ] CHR-08 — Hair and spring-bone simulation. First benchmark subset; full controls Later.
- [ ] CHR-09 — Character collision and interaction behaviors. Later.
- [ ] CHR-10 — Multiple characters with independent source assignments. First, for two performers.
- [ ] CHR-11 — Animation library workflow. Later; licensed content requires separate sourcing.

## Motion capture

Sources: [Motion capture overview](https://docs.warudo.app/docs/mocap/overview), [VMC](https://docs.warudo.app/docs/mocap/vmc), [iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap). Later adapters need a fresh review of their specific handbook pages.

- [ ] TRK-01 — External VMC receive. First.
- [ ] TRK-02 — External iFacialMocap receive. First.
- [ ] TRK-03 — FaceMotion3D compatibility. Later; do not infer it from iFacialMocap alone.
- [ ] TRK-04 — Face mapping, calibration, smoothing, and overrides. First subset.
- [ ] TRK-05 — Pose calibration, retargeting, offsets, and source mixing. First subset.
- [ ] TRK-06 — Pendulum motion behavior. Later.
- [ ] TRK-07 — MediaPipe integration. Later.
- [ ] TRK-08 — OpenSeeFace integration. Later.
- [ ] TRK-09 — RhyLive integration. Later.
- [ ] TRK-10 — SteamVR integration. Later.
- [ ] TRK-11 — Leap Motion integration. Later.
- [ ] TRK-12 — Sony Mocopi integration. Later.
- [ ] TRK-13 — Rokoko integration. Later.
- [ ] TRK-14 — Xsens MVN integration. Later.
- [ ] TRK-15 — Virdyn Studio integration. Later.
- [ ] TRK-16 — Noitom Axis integration. Later.
- [ ] TRK-17 — StretchSense glove integration. Later.
- [ ] TRK-18 — Autodesk MotionBuilder integration. Later.
- [ ] TRK-19 — Vicon Shogun integration. Later.
- [ ] TRK-20 — OptiTrack Motive integration. Later.
- [ ] TRK-21 — Chingmu Avatar integration. Later.

## Environment, props, and lighting

Sources: [Asset categories](https://docs.warudo.app/docs/assets/overview), [Environment](https://docs.warudo.app/docs/assets/environment), [Lights](https://docs.warudo.app/docs/assets/lights).

- [ ] ENV-01 — Environment import and placement. First.
- [ ] ENV-02 — Environment settings and sky/background controls. Later.
- [ ] ENV-03 — Prop import, transforms, attachments, and reuse. First subset.
- [ ] ENV-04 — Tail asset and tail interaction. Later.
- [ ] ENV-05 — Keyboard/trackpad visualization. Later.
- [ ] ENV-06 — Anchors and shared placement references. Later.
- [ ] ENV-07 — Directional and point lights. First.
- [ ] ENV-08 — Volumetric light and stage beam behavior. First benchmark subset; Approximate.
- [ ] ENV-09 — Wind controls. Later.
- [ ] ENV-10 — Particle effects and triggers. Later; benchmark includes a bounded sample.

## Cameras and output

Source: [Camera](https://docs.warudo.app/docs/assets/camera).

- [ ] CAM-01 — Camera entities, lens controls, free/orbit navigation. First subset.
- [ ] CAM-02 — Multiple cameras and camera selection. First.
- [ ] CAM-03 — Independent camera outputs; audit the documented eight-camera workflow. Later.
- [x] CAM-04 — Transparent output. Verified for smoke_v1 on macOS OBS WebGPU/WebGL2; broader materials remain separate.
- [ ] CAM-05 — Screenshots. First evaluation path; user-facing workflow Later.
- [ ] CAM-06 — Color grading, LUTs, tone mapping, and bloom. Later.
- [ ] CAM-07 — Ambient occlusion, flares, depth of field, and chromatic effects. Later.
- [ ] CAM-08 — Anti-aliasing and post-processing quality controls. First subset.
- [ ] CAM-09 — Spout/native output behavior. Later; platform adapter investigation.
- [ ] CAM-10 — NDI output. Deferred.

## Media and screens

Source: [Screen](https://docs.warudo.app/docs/assets/screen). Music and sender entries also appear in [the asset inventory](https://docs.warudo.app/docs/assets/overview).

- [ ] MED-01 — Image screens and transparency. Later.
- [ ] MED-02 — Video screens, playback, and supported codec diagnostics. First benchmark subset.
- [ ] MED-03 — Webpage screens and interactive content. Later; web pages need a separate capture design.
- [ ] MED-04 — Desktop and window capture into the scene. Later; native platform adapters.
- [ ] MED-05 — Curvature, crop, corners, tint, and chroma key. Later.
- [ ] MED-06 — Spout input to screens. Later; Windows adapter.
- [ ] MED-07 — NDI input to screens. Deferred.
- [ ] MED-08 — Music player and show playback controls. Later.
- [ ] MED-09 — VMC sender. Later.

## Show production and Pro capabilities

Sources: [Director](https://docs.warudo.app/docs/assets/director), [Motion recorder](https://docs.warudo.app/docs/assets/motion-recorder), [Motion player](https://docs.warudo.app/docs/assets/motion-player), [Warudo Pro](https://docs.warudo.app/docs/pro).

- [ ] SHOW-01 — Director camera control and transitions. Later.
- [ ] SHOW-02 — Record motion and expression data. Later.
- [ ] SHOW-03 — Replay recorded motion with show timing. Later.
- [ ] SHOW-04 — Studio motion-capture workflows. Later; depends on TRK-18 through TRK-21.
- [ ] SHOW-05 — Live production quality profiles. First benchmark; full Pro-like controls Later.

Unity URP is an engine implementation, not a portable feature. Track the resulting appearance and production controls in the renderer items below.

## Materials and advanced rendering

Sources: [Warudo Pro](https://docs.warudo.app/docs/pro), [Character](https://docs.warudo.app/docs/assets/character), and handbook asset entries for NiloToon controllers and post-processing. lilToon import behavior is an additional OpenSekai goal.

- [ ] MAT-01 — VRM MToon and glTF PBR. First.
- [ ] MAT-02 — Selected lilToon conversion profiles. Later; Approximate.
- [ ] MAT-03 — Full lilToon effect coverage. Later.
- [ ] MAT-04 — Selected NiloToon appearance profiles. Later; Approximate.
- [ ] MAT-05 — NiloToon volume and character control equivalents. Later; Different API.
- [ ] MAT-06 — Full NiloToon appearance coverage. Later; dependencies and rights require review.
- [ ] MAT-07 — Post-processing volumes and blending. Later.
- [ ] MAT-08 — Material parameter control from graphs. Later.

## Blueprints and interaction

Sources: [Blueprint overview](https://docs.warudo.app/docs/blueprints/overview) and the tutorial/preset categories in its navigation.

- [ ] BP-01 — Typed node runtime and data/flow ports. Early core; full node set Later.
- [ ] BP-02 — Visual editing, connections, palette, and validation. Later.
- [ ] BP-03 — Create, duplicate, rename, group, and arrange graphs. Later.
- [ ] BP-04 — Versioned graph import/export. Later; Different API.
- [ ] BP-05 — Tracking, character, scene, camera, and animation operations. Later.
- [ ] BP-06 — Keyboard, pointer, gamepad, MIDI, and event triggers. Later; audit each input route.
- [ ] BP-07 — Streaming events, chat, and redeems. Later; audit provider behavior.
- [ ] BP-08 — Clothes, accessory toggles, and prop interactions. Later.
- [ ] BP-09 — Karaoke, dance, and camera animation examples. Later.
- [ ] BP-10 — Deformation, plushie, physics, spark, and tail examples. Later.
- [ ] BP-11 — Pen hand sync, upper-body rotation, and sway presets. Later.
- [ ] BP-12 — Eye-motion presets. Later.
- [ ] BP-13 — Node-by-node handbook and runtime inventory audit. Later; required before a full blueprint parity claim.

## Authoring and extensions

Sources: [Mod SDK](https://docs.warudo.app/docs/modding/mod-sdk), [SDK installation](https://docs.warudo.app/docs/modding/sdk-installation), [Scripting overview](https://docs.warudo.app/docs/scripting/overview), and [DMX API](https://docs.warudo.app/docs/scripting/dmx-api).

- [ ] EXT-01 — Character, animation, environment, prop, and particle packages. Later.
- [ ] EXT-02 — Unity export adapter. Later; Different API.
- [ ] EXT-03 — Blender export adapter. Later; additional OpenSekai goal.
- [ ] EXT-04 — Package sharing, metadata, versions, and dependency checks. Later.
- [ ] EXT-05 — JS/TS custom nodes and asset types. Boundary early; guest delivery Later.
- [ ] EXT-06 — Scene queries, ports, triggers, events, and data watchers. Later; Different API.
- [ ] EXT-07 — Editor controls and validated property definitions. Later; Different API.
- [ ] EXT-08 — Persistence, graph generation, and temporary controls. Later; Different API.
- [ ] EXT-09 — External callbacks, resource resolvers, and localization. Later; Different API.
- [ ] EXT-10 — Plugin interoperability and debugging tools. Later.
- [ ] EXT-11 — Stream Deck integration. Later.
- [ ] EXT-12 — DMX lighting control. Later.
- [ ] EXT-13 — Sandbox resource limits and failure recovery. Required before guest plugins ship; additional OpenSekai goal.
- [ ] EXT-14 — Scripting API behavior audit. Later; required before extension parity claims.

## Additional OpenSekai acceptance requirements

These do not imply corresponding Warudo handbook features.

- [ ] OSE-01 — macOS production path verified.
- [ ] OSE-02 — Windows production path verified.
- [ ] OSE-03 — Separate WebGPU and WebGL 2 support reports.
- [ ] OSE-04 — Real concert hall at 1080p60 on proposed minimum hardware.
- [x] OSE-05 — Stable output while the editor is minimized. Verified on the smoke host: both backend timing repeats and sampled WebGPU recording.
- [x] OSE-06 — Early MCP scene queries, controlled edits, captures, and benchmark evidence. Verified for the scoped macOS release path.
- [x] OSE-07 — Frontier-model evaluation with reproducible evidence. Scoped smoke packet reviewed; provider model ID is not exposed.
- [ ] OSE-08 — Familiar hierarchy, inspector, viewport, assets, and output UI.
- [ ] OSE-09 — Undo/redo, project repair, and saved layouts.
- [ ] OSE-10 — Mobile feasibility investigation without replacing portable core.

## Evidence ledger

The desktop shell, shared contracts, scene worker, renderer, editor, and MCP have implementation evidence. The technical macOS smoke gates passed on the measured host. Clipboard UI acceptance remains pending; minimum-hardware and concert performance are unknown.

| Feature ID | Commit | Verified scope | Platform / backend | Evidence | Remaining gap |
| --- | --- | --- | --- | --- | --- |
| OSE-01, OSE-08 (partial) | 58b7955, b0cd4fb | Native desktop shell, shared Input/Button, version round trip | macOS / WKWebView; renderer absent | [Shell check](evaluation/macOS-feasibility/desktop-shell.md) | Later output/editor/MCP evidence below; Later smoke timing evidence is below; clipboard and full editor acceptance remain pending; these boxes stay unchecked |

| MAT-01, CAM-04, OSE-03 (partial) | 0009d97, 0f59ae0, 1848c85, 521468a | Controlled Chrome VRM1/MToon, GLB/PBR, both backends, alpha, marker, camera and reload; live OBS WebGL2 and release WebGPU image, current markers and camera changes | macOS / Chrome WebGPU and WebGL2; OBS WebGL2 and WebGPU | [First output check](evaluation/macOS-feasibility/first-output.md) | Historical partial scope; later smoke timing, alpha and lifecycle evidence is below. MAT-01 and OSE-03 remain unchecked; CAM-04 has a separate scoped verified row. |

| OSE-08 (partial) | 7072861, cb87325, 79f0d02 | Hierarchy selection, finite position validation, persistent position/visibility edits, both output cameras | macOS release / WKWebView and OBS WebGPU | [First output check](evaluation/macOS-feasibility/first-output.md) | Panel resizing and keyboard controls checked; clipboard and full editor acceptance pending; box remains unchecked |

| OSE-05 (scoped verified) | 75de982, 953ab9b, c5e107a | Two formal failures retained; native clock passed three prescribed timing runs per backend on the smoke fixture | macOS release / OBS WebGPU and WebGL2 | [Current results](evaluation/macOS-feasibility/results.md) | Sampled WebGPU recording and correlated hide/recreate recovery passed at c5e107a; five refreshes/ten-minute WebGPU soak passed at 1073130; clipboard UI acceptance, minimum hardware and concert scope remain separate |

| OSE-06 (scoped verified) | 75de982, c5e107a | All nine official MCP tools, registered capture/resource integrity, benchmark start/status/cancel, default read-only rejection | macOS release / OBS WebGPU | [MCP round trip](evaluation/macOS-feasibility/mcp-roundtrip.md) | All nine tools and registered resource integrity verified; no performance or broader production claim |

| CAM-04 (scoped verified) | c5e107a, 1073130 | Raw alpha and dark/light/checker smoke output reviewed; fresh capture/OBS marker correlation | macOS / OBS WebGPU and WebGL2 | [Current results](evaluation/macOS-feasibility/results.md) | Default Wide shoe crop is minor; runtime reframing is separate; broader material compatibility remains unchecked |

| OSE-07 (scoped verified) | c5e107a, 1073130 | Actual smoke images, recording samples, lifecycle and soak reviewed with capture hashes and reproducible crop defect | macOS / WebGPU and WebGL2 smoke evidence | [Final review scope](evaluation/macOS-feasibility/results.md) | Orchestration model label/effort recorded; provider ID not exposed; clipboard, GPU timing/reclamation, minimum hardware and concert remain separate |

The [shared contract check](evaluation/macOS-feasibility/contracts.md) records validation and client lifecycle evidence. It does not establish an OBS or MCP production feature.

## Audit maintenance

Before a parity release, review all handbook categories and linked pages. Record review date, relevant Warudo edition, behavior details, OpenSekai equivalents, and explicit gaps. The checklist baseline is broad; avoid publishing a parity percentage until denominator and partial-credit rules are fixed.
