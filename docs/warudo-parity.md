# Warudo feature parity checklist

Baseline reviewed: 2026-10-02. Source: [Warudo handbook](https://docs.warudo.app/docs).

[GitHub roadmap index #139](https://github.com/danirukun/opensekai/issues/139) tracks all checklist issues by area and status.

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

During implementation, update this file and its linked issue in the same feature checkpoint. Recheck the source page when the feature starts. Add new handbook items rather than silently reducing scope. Close an issue only when its stated scope is checked and has evidence. Keep partial and deferred issues open.

GitHub issues use `parity`, one `area:*` label, one `status:*` label, and a `phase:*` label for foundation or later work. Deferred items use `status:deferred`. `scope:approximate` and `scope:different-api` record explicit scope differences. An issue is a roadmap record; write a bounded slice contract before assigning implementation.

## Scene and asset management

Source: [Assets overview](https://docs.warudo.app/docs/assets/overview).

- [ ] SCN-01 — Create, remove, duplicate, and rename scene entities. Partial: current camera/avatar/tracker UI verified on macOS; additional asset types remain. [Check](evaluation/asset-management.md). Add › Character creates a character without a model, verified on macOS in a dev-build smoke check ([character check](evaluation/character-model-editor.md)). [GitHub #1](https://github.com/danirukun/opensekai/issues/1)
- [ ] SCN-02 — Groups, hierarchy, references, and property inspection. First. [GitHub #2](https://github.com/danirukun/opensekai/issues/2)
- [ ] SCN-03 — Asset export/import and copy between shows. Later. [GitHub #3](https://github.com/danirukun/opensekai/issues/3)
- [ ] SCN-04 — Merge imported settings into a selected entity. Later. [GitHub #4](https://github.com/danirukun/opensekai/issues/4)
- [ ] SCN-05 — Save/load shows and preserve missing references. Partial: native Save As/Open of a bounded scene plus one Blueprint, live macOS round trip, and retained unavailable avatar ID. Recent shows, recovery, release/Windows acceptance, and broader show workflow remain. [Check](evaluation/scene-show-management.md). [GitHub #5](https://github.com/danirukun/opensekai/issues/5)
- [ ] SCN-06 — Portable prepared packages and migration diagnostics. First; OpenSekai persistence requirement. [GitHub #6](https://github.com/danirukun/opensekai/issues/6)

## Characters and performance control

Source: [Character](https://docs.warudo.app/docs/assets/character).

- [ ] CHR-01 — VRM import and humanoid rig validation. First. Partial: the Inspector Model row chooses and replaces the VRM of a character, and asset records keep the model name. Models load in the background with a load status overlay. Safari load timing of a 75 MB VRM shows that frames continue during a load of about 2 s, but frames over 100 ms remain; the cold pipeline cache case is unknown ([load timing](evaluation/character-model-loading.md)). A model load through the macOS editor was not checked live. Humanoid rig validation remains. [GitHub #7](https://github.com/danirukun/opensekai/issues/7)
- [ ] CHR-02 — Prepared custom character packages. Later; Different API. [GitHub #8](https://github.com/danirukun/opensekai/issues/8)
- [ ] CHR-03 — Expressions, expression blending, and triggers. First for tracking; full controls Later. [GitHub #9](https://github.com/danirukun/opensekai/issues/9)
- [ ] CHR-04 — Idle animation and override clips. Partial: built-in default idle verified on macOS; imported Mixamo/VRMA and override clips remain later. [Check](evaluation/default-avatar-idle.md). [GitHub #10](https://github.com/danirukun/opensekai/issues/10)
- [ ] CHR-05 — Animation layers, masks, transitions, and one-shot playback. Later. [GitHub #11](https://github.com/danirukun/opensekai/issues/11)
- [ ] CHR-06 — Manual posing, IK, and look-at. Later. [GitHub #12](https://github.com/danirukun/opensekai/issues/12)
- [ ] CHR-07 — Bone attachment points and visibility/material control. Later. [GitHub #13](https://github.com/danirukun/opensekai/issues/13)
- [ ] CHR-08 — Hair and spring-bone simulation. First benchmark subset; full controls Later. [GitHub #14](https://github.com/danirukun/opensekai/issues/14)
- [ ] CHR-09 — Character collision and interaction behaviors. Later. [GitHub #15](https://github.com/danirukun/opensekai/issues/15)
- [ ] CHR-10 — Multiple characters with independent source assignments. First, for two performers. [GitHub #16](https://github.com/danirukun/opensekai/issues/16)
- [ ] CHR-11 — Animation library workflow. Later; licensed content requires separate sourcing. [GitHub #17](https://github.com/danirukun/opensekai/issues/17)

## Motion capture

Sources: [Motion capture overview](https://docs.warudo.app/docs/mocap/overview), [VMC](https://docs.warudo.app/docs/mocap/vmc), [iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap). Later adapters need a fresh review of their specific handbook pages.

- [ ] TRK-01 — External VMC receive. First. [GitHub #18](https://github.com/danirukun/opensekai/issues/18)
- [ ] TRK-02 — External iFacialMocap receive. First. [GitHub #19](https://github.com/danirukun/opensekai/issues/19)
- [ ] TRK-03 — FaceMotion3D compatibility. Later; do not infer it from iFacialMocap alone. [GitHub #20](https://github.com/danirukun/opensekai/issues/20)
- [ ] TRK-04 — Face mapping, calibration, smoothing, and overrides. Partial: shared One Euro smoothing, per-source tuning/bypass/reset and named 52-channel ARKit mapping verified; calibration and overrides remain. [Check](evaluation/one-euro-filter.md). [GitHub #21](https://github.com/danirukun/opensekai/issues/21)
- [ ] TRK-05 — Pose calibration, retargeting, offsets, and source mixing. First subset. [GitHub #22](https://github.com/danirukun/opensekai/issues/22)
- [ ] TRK-06 — Pendulum motion behavior. Later. [GitHub #23](https://github.com/danirukun/opensekai/issues/23)
- [ ] TRK-07 — MediaPipe integration. First useful-build requirement; face, upper body and fingers; physical-camera evidence required. [GitHub #24](https://github.com/danirukun/opensekai/issues/24)
- [ ] TRK-08 — OpenSeeFace integration. Later. [GitHub #25](https://github.com/danirukun/opensekai/issues/25)
- [ ] TRK-09 — RhyLive integration. Later. [GitHub #26](https://github.com/danirukun/opensekai/issues/26)
- [ ] TRK-10 — SteamVR integration. Later. [GitHub #27](https://github.com/danirukun/opensekai/issues/27)
- [ ] TRK-11 — Leap Motion integration. Later. [GitHub #28](https://github.com/danirukun/opensekai/issues/28)
- [ ] TRK-12 — Sony Mocopi integration. Later. [GitHub #29](https://github.com/danirukun/opensekai/issues/29)
- [ ] TRK-13 — Rokoko integration. Later. [GitHub #30](https://github.com/danirukun/opensekai/issues/30)
- [ ] TRK-14 — Xsens MVN integration. Later. [GitHub #31](https://github.com/danirukun/opensekai/issues/31)
- [ ] TRK-15 — Virdyn Studio integration. Later. [GitHub #32](https://github.com/danirukun/opensekai/issues/32)
- [ ] TRK-16 — Noitom Axis integration. Later. [GitHub #33](https://github.com/danirukun/opensekai/issues/33)
- [ ] TRK-17 — StretchSense glove integration. Later. [GitHub #34](https://github.com/danirukun/opensekai/issues/34)
- [ ] TRK-18 — Autodesk MotionBuilder integration. Later. [GitHub #35](https://github.com/danirukun/opensekai/issues/35)
- [ ] TRK-19 — Vicon Shogun integration. Later. [GitHub #36](https://github.com/danirukun/opensekai/issues/36)
- [ ] TRK-20 — OptiTrack Motive integration. Later. [GitHub #37](https://github.com/danirukun/opensekai/issues/37)
- [ ] TRK-21 — Chingmu Avatar integration. Later. [GitHub #38](https://github.com/danirukun/opensekai/issues/38)

## Environment, props, and lighting

Sources: [Asset categories](https://docs.warudo.app/docs/assets/overview), [Environment](https://docs.warudo.app/docs/assets/environment), [Lights](https://docs.warudo.app/docs/assets/lights).

- [ ] ENV-01 — Environment import and placement. First. [GitHub #39](https://github.com/danirukun/opensekai/issues/39)
- [ ] ENV-02 — Environment settings and sky/background controls. Later. [GitHub #40](https://github.com/danirukun/opensekai/issues/40)
- [ ] ENV-03 — Prop import, transforms, attachments, and reuse. First subset. [GitHub #41](https://github.com/danirukun/opensekai/issues/41)
- [ ] ENV-04 — Tail asset and tail interaction. Later. [GitHub #42](https://github.com/danirukun/opensekai/issues/42)
- [ ] ENV-05 — Keyboard/trackpad visualization. Later. [GitHub #43](https://github.com/danirukun/opensekai/issues/43)
- [ ] ENV-06 — Anchors and shared placement references. Later. [GitHub #44](https://github.com/danirukun/opensekai/issues/44)
- [ ] ENV-07 — Directional and point lights. First. [GitHub #45](https://github.com/danirukun/opensekai/issues/45)
- [ ] ENV-08 — Volumetric light and stage beam behavior. First benchmark subset; Approximate. [GitHub #46](https://github.com/danirukun/opensekai/issues/46)
- [ ] ENV-09 — Wind controls. Later. [GitHub #47](https://github.com/danirukun/opensekai/issues/47)
- [ ] ENV-10 — Particle effects and triggers. Later; benchmark includes a bounded sample. [GitHub #48](https://github.com/danirukun/opensekai/issues/48)

## Cameras and output

Source: [Camera](https://docs.warudo.app/docs/assets/camera).

- [ ] CAM-01 — Camera entities, lens controls, free/orbit navigation. First subset. [GitHub #49](https://github.com/danirukun/opensekai/issues/49)
- [ ] CAM-02 — Multiple cameras and camera selection. First. [GitHub #50](https://github.com/danirukun/opensekai/issues/50)
- [ ] CAM-03 — Independent camera outputs; audit the documented eight-camera workflow. Later. [GitHub #51](https://github.com/danirukun/opensekai/issues/51)
- [x] CAM-04 — Transparent output. Verified for smoke_v1 on macOS OBS WebGPU/WebGL2; broader materials remain separate. [GitHub #52](https://github.com/danirukun/opensekai/issues/52)
- [ ] CAM-05 — Screenshots. First evaluation path; user-facing workflow Later. [GitHub #53](https://github.com/danirukun/opensekai/issues/53)
- [ ] CAM-06 — Color grading, LUTs, tone mapping, and bloom. Later. [GitHub #54](https://github.com/danirukun/opensekai/issues/54)
- [ ] CAM-07 — Ambient occlusion, flares, depth of field, and chromatic effects. Later. [GitHub #55](https://github.com/danirukun/opensekai/issues/55)
- [ ] CAM-08 — Anti-aliasing and post-processing quality controls. First subset. [GitHub #56](https://github.com/danirukun/opensekai/issues/56)
- [ ] CAM-09 — Spout/native output behavior. Later; platform adapter investigation. [GitHub #57](https://github.com/danirukun/opensekai/issues/57)
- [ ] CAM-10 — NDI output. Deferred. [GitHub #58](https://github.com/danirukun/opensekai/issues/58)

## Media and screens

Source: [Screen](https://docs.warudo.app/docs/assets/screen). Music and sender entries also appear in [the asset inventory](https://docs.warudo.app/docs/assets/overview).

- [ ] MED-01 — Image screens and transparency. Later. [GitHub #59](https://github.com/danirukun/opensekai/issues/59)
- [ ] MED-02 — Video screens, playback, and supported codec diagnostics. First benchmark subset. [GitHub #60](https://github.com/danirukun/opensekai/issues/60)
- [ ] MED-03 — Webpage screens and interactive content. Later; web pages need a separate capture design. [GitHub #61](https://github.com/danirukun/opensekai/issues/61)
- [ ] MED-04 — Desktop and window capture into the scene. Later; native platform adapters. [GitHub #62](https://github.com/danirukun/opensekai/issues/62)
- [ ] MED-05 — Curvature, crop, corners, tint, and chroma key. Later. [GitHub #63](https://github.com/danirukun/opensekai/issues/63)
- [ ] MED-06 — Spout input to screens. Later; Windows adapter. [GitHub #64](https://github.com/danirukun/opensekai/issues/64)
- [ ] MED-07 — NDI input to screens. Deferred. [GitHub #65](https://github.com/danirukun/opensekai/issues/65)
- [ ] MED-08 — Music player and show playback controls. Later. [GitHub #66](https://github.com/danirukun/opensekai/issues/66)
- [ ] MED-09 — VMC sender. Later. [GitHub #67](https://github.com/danirukun/opensekai/issues/67)

## Show production and Pro capabilities

Sources: [Director](https://docs.warudo.app/docs/assets/director), [Motion recorder](https://docs.warudo.app/docs/assets/motion-recorder), [Motion player](https://docs.warudo.app/docs/assets/motion-player), [Warudo Pro](https://docs.warudo.app/docs/pro).

- [ ] SHOW-01 — Director camera control and transitions. Later. [GitHub #68](https://github.com/danirukun/opensekai/issues/68)
- [ ] SHOW-02 — Record motion and expression data. Later. [GitHub #69](https://github.com/danirukun/opensekai/issues/69)
- [ ] SHOW-03 — Replay recorded motion with show timing. Later. [GitHub #70](https://github.com/danirukun/opensekai/issues/70)
- [ ] SHOW-04 — Studio motion-capture workflows. Later; depends on TRK-18 through TRK-21. [GitHub #71](https://github.com/danirukun/opensekai/issues/71)
- [ ] SHOW-05 — Live production quality profiles. First benchmark; full Pro-like controls Later. [GitHub #72](https://github.com/danirukun/opensekai/issues/72)

Unity URP is an engine implementation, not a portable feature. Track the resulting appearance and production controls in the renderer items below.

## Materials and advanced rendering

Sources: [Warudo Pro](https://docs.warudo.app/docs/pro), [Character](https://docs.warudo.app/docs/assets/character), and handbook asset entries for NiloToon controllers and post-processing. lilToon import behavior is an additional OpenSekai goal.

- [ ] MAT-01 — VRM MToon and glTF PBR. First. [GitHub #73](https://github.com/danirukun/opensekai/issues/73)
- [ ] MAT-02 — Selected lilToon conversion profiles. Later; Approximate. [GitHub #74](https://github.com/danirukun/opensekai/issues/74)
- [ ] MAT-03 — Full lilToon effect coverage. Later. [GitHub #75](https://github.com/danirukun/opensekai/issues/75)
- [ ] MAT-04 — Selected NiloToon appearance profiles. Later; Approximate. [GitHub #76](https://github.com/danirukun/opensekai/issues/76)
- [ ] MAT-05 — NiloToon volume and character control equivalents. Later; Different API. [GitHub #77](https://github.com/danirukun/opensekai/issues/77)
- [ ] MAT-06 — Full NiloToon appearance coverage. Later; dependencies and rights require review. [GitHub #78](https://github.com/danirukun/opensekai/issues/78)
- [ ] MAT-07 — Post-processing volumes and blending. Later. [GitHub #79](https://github.com/danirukun/opensekai/issues/79)
- [ ] MAT-08 — Material parameter control from graphs. Later. [GitHub #80](https://github.com/danirukun/opensekai/issues/80)

## Blueprints and interaction

Sources: [Blueprint overview](https://docs.warudo.app/docs/blueprints/overview) and the tutorial/preset categories in its navigation.

- [ ] BP-01 — Typed node runtime and data/flow ports. Partial: versioned graph, six typed built-in nodes, validation, bounded manual execution, scene visibility effect, public edit command route, and one graph saved with its scene. On macOS the event scheduler on the session clock, Flip Flop, Delay, Set Visibility, Toggle Visibility, Switch Camera, and the last valid version running while an edit does not compile are verified. If Branch, Sequence, and Not are covered by unit tests only; they were not run live. [Hotkey check](evaluation/blueprint-interactions.md). One definition per node type now drives 42 node types. Typed graph variables (number and boolean) with reset on install, logic change, and enable are in the contract and runtime. On macOS a hotkey graph that counts with Add To Number Variable and Get Number Variable and cuts cameras through Switch On Number is verified, also after Save and Open ([catalog check](evaluation/blueprint-catalog.md)). On Enable, Gate, Multi Gate, Throttle, For Loop, Random Number, and the math, compare, and logic nodes are covered by unit and session integration tests only. On macOS On Update, Vector3 values, and a runtime override layer that commits 250 ms after the last write are verified with a WASD graph ([continuous check](evaluation/continuous-blueprints.md)). Character and camera actions, strings, and functions remain. [Checks](evaluation/blueprint-foundation.md), [Rete editor](evaluation/rete-blueprint-editor.md), [show persistence](evaluation/scene-show-management.md). [GitHub #81](https://github.com/danirukun/opensekai/issues/81)
- [ ] BP-02 — Visual editing, connections, palette, and validation. Partial: Rete draft canvas, typed sockets, node palette, selection, property edits, node deletion, draft retention, pre-run validation, and Save As/Open of one graph in a show. Live sync between clients and error location are verified through the editor and MCP on macOS. Catalog-driven sockets and Warudo port multiplicity are covered by unit tests only. Typing into the keystroke capture field was not exercised. [Hotkey check](evaluation/blueprint-interactions.md). The node search palette, the canvas, node, and wire context menus, search on wire release, keyboard shortcuts, copy and paste across graphs, duplicate, undo and redo, the Variables drawer, and canvas drag and connect gestures are verified on macOS with synthetic input ([catalog check](evaluation/blueprint-catalog.md)). A physical ⌘-click was not tested. Box select, grouping, comments, and auto layout remain. [Checks](evaluation/rete-blueprint-editor.md), [show persistence](evaluation/scene-show-management.md). [GitHub #82](https://github.com/danirukun/opensekai/issues/82)
- [ ] BP-03 — Create, duplicate, rename, group, and arrange graphs. Partial: create, rename, and enable or disable verified on macOS. Graph removal and the limit of 8 graphs are covered by unit tests only. [Hotkey check](evaluation/blueprint-interactions.md). Import adds a graph from a file (see BP-04). Duplicate, group, and arrange remain. [GitHub #83](https://github.com/danirukun/opensekai/issues/83)
- [ ] BP-04 — Versioned graph import/export. Partial: one Blueprint exports to an OpenSekai JSON file and imports into a show from the editor and MCP. A graph with a missing reference imports disabled with a `Missing` list. A file with a future version, an unknown node, or a Warudo shape is rejected. On macOS the import, export, re-import, missing-reference display, rejection of a Warudo-shaped file, and Cancel are verified; the runner passed 10 of 10 cases ([Blueprint files check](evaluation/blueprint-files.md)). Different: Warudo files are not read, and the macOS dialogs do not filter to `.json`. The runner registered the `camera-flip` and `counter` keystrokes but did not fire them; the session integration test covers their effect. Physical keys after an import, OBS output, and Windows remain. [GitHub #84](https://github.com/danirukun/opensekai/issues/84)
- [ ] BP-05 — Tracking, character, scene, camera, and animation operations. Partial: Get Asset Property and Set Asset Property for Position, Rotation, Scale, Visible, and camera Field of View, and Move Entity in world or local space. On macOS Move Entity with held keys is verified; the other properties are covered by unit tests only. [Continuous check](evaluation/continuous-blueprints.md). Tracking, character, camera, and animation operations remain. [GitHub #85](https://github.com/danirukun/opensekai/issues/85)
- [ ] BP-06 — Keyboard, pointer, gamepad, MIDI, and event triggers. Partial: global keyboard hotkeys on macOS, with Different behavior because OpenSekai holds the registered combination and other apps do not receive it. The editor warning covers an OS registration failure only: macOS accepts a combination that a system feature such as Spotlight also uses, and both then fire (Different). Hotkeys recover after a publisher reconnect; the Save As and Open path was not re-run. [Hotkey check](evaluation/blueprint-interactions.md). Held keys (Is Key Held, Key Axis) work on macOS while another app has focus, and that app still receives the keys, as in Warudo; this needs the Input Monitoring permission and a restart after the grant ([continuous check](evaluation/continuous-blueprints.md)). Windows, pointer, gamepad, MIDI, and event triggers remain; audit each input route. [GitHub #86](https://github.com/danirukun/opensekai/issues/86)
- [ ] BP-07 — Streaming events, chat, and redeems. Later; audit provider behavior. [GitHub #87](https://github.com/danirukun/opensekai/issues/87)
- [ ] BP-08 — Clothes, accessory toggles, and prop interactions. Later. [GitHub #88](https://github.com/danirukun/opensekai/issues/88)
- [ ] BP-09 — Karaoke, dance, and camera animation examples. Later. [GitHub #89](https://github.com/danirukun/opensekai/issues/89)
- [ ] BP-10 — Deformation, plushie, physics, spark, and tail examples. Later. [GitHub #90](https://github.com/danirukun/opensekai/issues/90)
- [ ] BP-11 — Pen hand sync, upper-body rotation, and sway presets. Later. [GitHub #91](https://github.com/danirukun/opensekai/issues/91)
- [ ] BP-12 — Eye-motion presets. Later. [GitHub #92](https://github.com/danirukun/opensekai/issues/92)
- [ ] BP-13 — Node-by-node handbook and runtime inventory audit. Later; required before a full blueprint parity claim. [GitHub #93](https://github.com/danirukun/opensekai/issues/93)

## Authoring and extensions

Sources: [Mod SDK](https://docs.warudo.app/docs/modding/mod-sdk), [SDK installation](https://docs.warudo.app/docs/modding/sdk-installation), [Scripting overview](https://docs.warudo.app/docs/scripting/overview), and [DMX API](https://docs.warudo.app/docs/scripting/dmx-api).

- [ ] EXT-01 — Character, animation, environment, prop, and particle packages. Later. [GitHub #94](https://github.com/danirukun/opensekai/issues/94)
- [ ] EXT-02 — Unity export adapter. Later; Different API. [GitHub #95](https://github.com/danirukun/opensekai/issues/95)
- [ ] EXT-03 — Blender export adapter. Later; additional OpenSekai goal. [GitHub #96](https://github.com/danirukun/opensekai/issues/96)
- [ ] EXT-04 — Package sharing, metadata, versions, and dependency checks. Later. [GitHub #97](https://github.com/danirukun/opensekai/issues/97)
- [ ] EXT-05 — JS/TS custom nodes and asset types. Boundary early; guest delivery Later. [GitHub #98](https://github.com/danirukun/opensekai/issues/98)
- [ ] EXT-06 — Scene queries, ports, triggers, events, and data watchers. Later; Different API. [GitHub #99](https://github.com/danirukun/opensekai/issues/99)
- [ ] EXT-07 — Editor controls and validated property definitions. Later; Different API. [GitHub #100](https://github.com/danirukun/opensekai/issues/100)
- [ ] EXT-08 — Persistence, graph generation, and temporary controls. Later; Different API. [GitHub #101](https://github.com/danirukun/opensekai/issues/101)
- [ ] EXT-09 — External callbacks, resource resolvers, and localization. Later; Different API. [GitHub #102](https://github.com/danirukun/opensekai/issues/102)
- [ ] EXT-10 — Plugin interoperability and debugging tools. Later. [GitHub #103](https://github.com/danirukun/opensekai/issues/103)
- [ ] EXT-11 — Stream Deck integration. Later. [GitHub #104](https://github.com/danirukun/opensekai/issues/104)
- [ ] EXT-12 — DMX lighting control. Later. [GitHub #105](https://github.com/danirukun/opensekai/issues/105)
- [ ] EXT-13 — Sandbox resource limits and failure recovery. Required before guest plugins ship; additional OpenSekai goal. [GitHub #106](https://github.com/danirukun/opensekai/issues/106)
- [ ] EXT-14 — Scripting API behavior audit. Later; required before extension parity claims. [GitHub #107](https://github.com/danirukun/opensekai/issues/107)

## Additional OpenSekai acceptance requirements

These do not imply corresponding Warudo handbook features.

- [ ] OSE-01 — macOS production path verified. [GitHub #108](https://github.com/danirukun/opensekai/issues/108)
- [ ] OSE-02 — Windows production path verified. [GitHub #109](https://github.com/danirukun/opensekai/issues/109)
- [ ] OSE-03 — Separate WebGPU and WebGL 2 support reports. [GitHub #110](https://github.com/danirukun/opensekai/issues/110)
- [ ] OSE-04 — Real concert hall at 1080p60 on proposed minimum hardware. [GitHub #111](https://github.com/danirukun/opensekai/issues/111)
- [x] OSE-05 — Stable output while the editor is minimized. Verified on the smoke host: both backend timing repeats and sampled WebGPU recording. [GitHub #112](https://github.com/danirukun/opensekai/issues/112)
- [x] OSE-06 — Early MCP scene queries, controlled edits, captures, and benchmark evidence. Verified for the scoped macOS release path. [GitHub #113](https://github.com/danirukun/opensekai/issues/113)
- [x] OSE-07 — Frontier-model evaluation with reproducible evidence. Scoped smoke packet reviewed; provider model ID is not exposed. [GitHub #114](https://github.com/danirukun/opensekai/issues/114)
- [ ] OSE-08 — Familiar hierarchy, inspector, viewport, assets, and output UI. [GitHub #115](https://github.com/danirukun/opensekai/issues/115)
- [ ] OSE-09 — Undo/redo, project repair, and saved layouts. [GitHub #116](https://github.com/danirukun/opensekai/issues/116)
- [ ] OSE-10 — Mobile feasibility investigation without replacing portable core. [GitHub #117](https://github.com/danirukun/opensekai/issues/117)

## Verified editor subset

These split the first editor slice from broad OSE-08 and SCN-02. The broad boxes remain unchecked.

- [x] UI-01 — Separate Scene/Editor windows, light asset/property layout and 620-pixel property view on macOS. [GitHub #118](https://github.com/danirukun/opensekai/issues/118)
- [x] UI-02 — Numeric transform input, label scrubbing, reset and invalid-scale rejection on macOS. [GitHub #119](https://github.com/danirukun/opensekai/issues/119)
- [x] UI-03 — Preview selection and released Move/Rotate/Scale gestures; production output has no gizmo. Scene-only evaluation harness used for pointer targeting. [GitHub #120](https://github.com/danirukun/opensekai/issues/120)
- [x] UI-04 — Context-menu keyboard actions, menu Escape, panel resizing and editor hide/reopen on macOS. [GitHub #121](https://github.com/danirukun/opensekai/issues/121)
- [x] UI-05 — Actual OBS URL copy and private clipboard match on macOS. [GitHub #122](https://github.com/danirukun/opensekai/issues/122)
- [x] UI-06 — Renderer unsupported-feature warnings retained in Resources. [GitHub #123](https://github.com/danirukun/opensekai/issues/123)
- [x] UI-07 — Type groups, collapse/search, sidebar visibility and active output camera actions on macOS. [GitHub #124](https://github.com/danirukun/opensekai/issues/124)
- [x] UI-08 — Live numeric transforms, scrub/reset, bounded coalescing and focus handoff on macOS; verified with clean OBS. [Check](evaluation/live-editor-controls.md). [GitHub #125](https://github.com/danirukun/opensekai/issues/125)

- [x] UI-09 — Asset Rename/Duplicate/Remove menu, inline name editing, safe stopped/unassigned copies, camera guard and source cleanup on macOS. Duplicate-VRM memory failure reproduced and corrected with bounded textures. [Check](evaluation/asset-management.md). [GitHub #137](https://github.com/danirukun/opensekai/issues/137)
- [x] UI-10 — Exact Scene preview camera frame, responsive fit, and editor-only output boundary. [GitHub #138](https://github.com/danirukun/opensekai/issues/138)
- [ ] UI-11 — Toggleable stats.js Scene preview monitor. Source and release build pass; live macOS toggle and OBS isolation check remain. [Check](evaluation/scene-performance-monitor.md). The preview renders at display rate, not 15 Hz ([avatar performance](evaluation/avatar-performance.md)). A macOS dev-build smoke check showed 56 FPS (range 0–60) on the monitor ([character check](evaluation/character-model-editor.md)). [GitHub #141](https://github.com/danirukun/opensekai/issues/141)

## Evidence ledger

The desktop shell, shared contracts, scene worker, renderer, editor, and MCP have implementation evidence. The technical macOS smoke gates passed on the measured host. Clipboard UI acceptance passed under explicit authorization at ce6bccb. Minimum-hardware and concert performance are unknown. Earlier rows retain their historical scope.

| Feature ID | Commit | Verified scope | Platform / backend | Evidence | Remaining gap |
| --- | --- | --- | --- | --- | --- |
| OSE-01, OSE-08 (partial) | 58b7955, b0cd4fb | Native desktop shell, shared Input/Button, version round trip | macOS / WKWebView; renderer absent | [Shell check](evaluation/macOS-feasibility/desktop-shell.md) | Later output/editor/MCP evidence below; Later smoke timing evidence is below; clipboard and full editor acceptance remain pending; these boxes stay unchecked |
| MAT-01, CAM-04, OSE-03 (partial) | 0009d97, 0f59ae0, 1848c85, 521468a | Controlled Chrome VRM1/MToon, GLB/PBR, both backends, alpha, marker, camera and reload; live OBS WebGL2 and release WebGPU image, current markers and camera changes | macOS / Chrome WebGPU and WebGL2; OBS WebGL2 and WebGPU | [First output check](evaluation/macOS-feasibility/first-output.md) | Historical partial scope; later smoke timing, alpha and lifecycle evidence is below. MAT-01 and OSE-03 remain unchecked; CAM-04 has a separate scoped verified row. |
| OSE-08 (partial) | 7072861, cb87325, 79f0d02 | Hierarchy selection, finite position validation, persistent position/visibility edits, both output cameras | macOS release / WKWebView and OBS WebGPU | [First output check](evaluation/macOS-feasibility/first-output.md) | Panel resizing and keyboard controls checked; clipboard and full editor acceptance pending; box remains unchecked |
| OSE-05 (scoped verified) | 75de982, 953ab9b, c5e107a | Two formal failures retained; native clock passed three prescribed timing runs per backend on the smoke fixture | macOS release / OBS WebGPU and WebGL2 | [Current results](evaluation/macOS-feasibility/results.md) | Sampled WebGPU recording and correlated hide/recreate recovery passed at c5e107a; five refreshes/ten-minute WebGPU soak passed at 1073130; clipboard UI acceptance, minimum hardware and concert scope remain separate |
| OSE-06 (scoped verified) | 75de982, c5e107a | All nine official MCP tools, registered capture/resource integrity, benchmark start/status/cancel, default read-only rejection | macOS release / OBS WebGPU | [MCP round trip](evaluation/macOS-feasibility/mcp-roundtrip.md) | All nine tools and registered resource integrity verified; no performance or broader production claim |
| CAM-04 (scoped verified) | c5e107a, 1073130 | Raw alpha and dark/light/checker smoke output reviewed; fresh capture/OBS marker correlation | macOS / OBS WebGPU and WebGL2 | [Current results](evaluation/macOS-feasibility/results.md) | Default Wide shoe crop is minor; runtime reframing is separate; broader material compatibility remains unchecked |
| OSE-07 (scoped verified) | c5e107a, 1073130 | Actual smoke images, recording samples, lifecycle and soak reviewed with capture hashes and reproducible crop defect | macOS / WebGPU and WebGL2 smoke evidence | [Final review scope](evaluation/macOS-feasibility/results.md) | Orchestration model label/effort recorded; provider ID not exposed; clipboard, GPU timing/reclamation, minimum hardware and concert remain separate |
| UI-01 through UI-06; OSE-08 and SCN-02 (partial) | 36d8519, 68b9293, ce6bccb | Separate windows, property edits, gizmos, menus, resizing, clipboard and warnings | macOS release / WKWebView and OBS WebGPU | [Editor interaction check](evaluation/warudo-editor-interactions.md) | Full hierarchy/CRUD/property coverage and active pointer Escape live verification remain open; scene-only and compact harnesses identified separately |
| SCN-01 (partial), UI-09 (scoped verified) | dca1d16 | Current camera/avatar/tracker create, rename, duplicate and remove; source cleanup, camera guard and bounded duplicate-VRM memory | macOS / WKWebView and clean OBS WebGPU | [Asset management check](evaluation/asset-management.md) | Additional asset types, texture-quality overrides, full memory reclamation, WebGL and Windows remain separate |
| SCN-05, BP-01, BP-02 (partial) | 60c9628 | Native Save As/Open for one scene and graph; revision-checked replacement; missing avatar ID retained; reopened Blueprint ran; release app launched from `pnpm build:mac` | macOS debug and release / WKWebView; renderer backend not measured | [Show management check](evaluation/scene-show-management.md) | Windows, recent shows, recovery, graph manager, portable assets, and OBS continuity during Open remain open |
| BP-01, BP-02, BP-03, BP-06 (partial) | 67cffe2 | Global ⌃⌥ hotkeys drove Toggle Visibility, Set Visibility with Delay (OBS interval 1985 ms), and a Flip Flop camera cut; held key toggled once; last valid version ran while a wire was missing; MCP rename shown in the open editor; Save As and Open worked | macOS release / WKWebView; WebGPU in OBS; Warudo live comparison impossible on the VMPal guest | [Blueprint interactions check](evaluation/blueprint-interactions.md), [index](evaluation/blueprint-interactions-evidence.json) | Hotkeys stopped after a publisher reconnect (fixed in `954b5cf`, GUI Save As and Open not re-run); no warning for ⌘Space, which is Different; canvas gestures, app timing, held physical key, and Windows not exercised |
| BP-01, BP-02, BP-03 (partial) | 58cd3d1 | Context menus, search palette, wire-release search, shortcuts, copy and paste across graphs, undo and redo, Variables drawer; a ⌃⌥H counter graph cut Camera 2, Camera, Camera; Save and Open kept the variable and the graph | macOS debug / WKWebView; renderer backend not measured; OBS not connected | [Blueprint catalog check](evaluation/blueprint-catalog.md) | Synthetic input only; physical ⌘-click, OBS frames, animation timing, Windows, and live Warudo comparison not exercised |
| BP-01, BP-05, BP-06 (partial) | 05d2b31 | WASD graph (On Update, Key Axis, Vector3, Move Entity) moved a VRM character while TextEdit and Notes had focus and received the keys; scene revision unchanged during motion and +1 after each release; drag won over the override; Input Monitoring warning without access; saved show kept the graph and the committed position | macOS debug and release / WKWebView; renderer backend not measured; OBS not running | [Continuous Blueprints check](evaluation/continuous-blueprints.md) | OBS output, secure input, Open Settings click, Windows key monitor, and app timing not exercised; the grant needs an app restart |
| BP-03, BP-04 (partial) | e0a7c40 | Import of `counter.json` into a show showed `Missing: camera_close, camera_wide`; cameras chosen and graph enabled; export and re-import connected without a Missing line; Warudo-shaped file rejected; Import then Cancel changed nothing; runner passed 10 of 10 cases at `07bda9f` | macOS debug / WKWebView; renderer backend not recorded; OBS not running | [Blueprint files check](evaluation/blueprint-files.md), [run report](evaluation/blueprint-files-run.json) | The runner registered the `camera-flip` and `counter` keystrokes but did not fire them (the session integration test covers their effect); physical keys after an import, OBS output, Windows, and app timing not exercised; macOS dialogs do not filter to `.json` (Different); Warudo files are not read (Different) |
| SCN-01, CHR-01, UI-11 (partial) | d82a724 | Add › Character without a model and the Model row; Scene preview at display rate (56 FPS on the monitor); Safari load of a 75 MB VRM in about 2 s while frames continue | macOS dev build / WKWebView, synthetic input; Safari 27, backend not recorded | [Character check](evaluation/character-model-editor.md), [load timing](evaluation/character-model-loading.md), [avatar performance](evaluation/avatar-performance.md) | No VRM loaded through the editor; frames over 100 ms during a load; cold pipeline cache unknown; OBS not connected; UI-11 toggle, persistence, and OBS isolation remain |

| UI-10 (scoped verified), MAT-01 (partial) | 47b7fd0 | Exact preview frame, resize, pointer selection, clean VRM output; official VRM node material path confirmed | macOS / WKWebView and OBS WebGPU | [Camera frame check](evaluation/camera-frame.md) | Independent editor camera, overscan, broader material parity, Windows, and concert benchmark remain separate |

The [shared contract check](evaluation/macOS-feasibility/contracts.md) records validation and client lifecycle evidence. It does not establish an OBS or MCP production feature.

## Audit maintenance

Before a parity release, review all handbook categories and linked pages. Record review date, relevant Warudo edition, behavior details, OpenSekai equivalents, and explicit gaps. The checklist baseline is broad; avoid publishing a parity percentage until denominator and partial-credit rules are fixed.

## Current minimum delivery slice

The [minimum live VTubing plan](superpowers/plans/2026-10-03-minimum-live-vtubing.md) prioritizes VRM import, receiver assets, mixed external motion, camera authoring, OBS and MediaPipe. These remain unchecked until their actual flows and evidence pass. Mock data is permitted but must be identified.

Minimum live slice checkpoint: atomic asset creation, camera lens edits, source assignment, generation checks, and stale pose fading pass focused session tests. Import, physical tracking, and packaged UI acceptance remain unchecked.

Tracking/editor integration checkpoint: source clock forwarding, native receipt freshness, generation-filtered local MediaPipe input, empty-scene authoring, and connected type-specific controls pass282 unit tests and workspace type/Svelte checks. Model preparation verifies3 local task models and6 matching WASM files. Native contracts/import/UDP and renderer lanes passed scoped review. Packaged model execution, webcam permission, supplied-avatar motion, OBS, and phone acceptance are still pending.

Native integration checkpoint: Rust contracts pass14 tests; integrated UDP-to-credited-clock and managed-import/restart boundaries pass6 tests. Native lane reports71 passing checks plus1 explicit fixture skip and strict Clippy. Chestless VRM1 normalized torso fallback passed43 renderer tests and independent review. The native chooser and desktop flows still need packaged-app acceptance.

Live startup at7a286ad passed outside the checkout without fixture mode; Add Camera and lens controls were visible. Native chooser Open remained disabled for the supplied VRM and a private local copy. Reviewed macOS all-files compatibility and persistent validation-error fixes are ready for a live A/B check; import is not yet marked complete.


Minimum live acceptance at72ace50: native chooser import of the supplied VRM0, actual camera lens editing/validation, mixed VMC-body/iFacial-face UDP mocks, transparent OBS avatar output, and actual bundled MediaPipe webcam inference passed their scoped checks. The physical iPhone check remains the last step. The [minimum live check](evaluation/minimum-live-vtubing.md) records limits, source checks and sampled continuity. Full categories remain unchecked. Review found diagnostics enabled in the copied production URL; the helper-free URL regression now passes and packaged recheck is next.

Inference measurement contract checkpoint: optional finite inferenceMs is available through the existing TrackingStatus/AppStatus shape. Legacy status omits it. TypeScript and Rust boundary tests cover limits. Actual worker publication and packaged measurement remain pending.

Rebuilt f507cfc actual Add actions, import and copied helper-free OBS URL passed. Actual three-task inference samples measured median64ms/p9582ms, separate from render CPU; Stop cleared the metric. Receiver bind-conflict error and port restoration passed UI. Repeated editor-only camera Start remained waiting until Scene activation; a fixed editor-only Scene activation command and tested configuration ordering are integrated for packaged recheck.

Packaged20898ff MediaPipe Start automatically activated Scene and reached receiving without OBS; default face/pose timing median17ms/p9535ms.296unit tests and100Rust tests passed,1fixture skip. The custom output camera selector was found to retain smoke-only IDs; a tested scene-derived selector is ready for packaged Camera2/OBS verification.


## Verified minimum live subset

These scoped checks do not complete the broader character, tracking, camera or production categories. See [minimum live acceptance](evaluation/minimum-live-vtubing.md).

- [x] LIVE-01 — Native chooser imports the supplied VRM0 in normal macOS startup. [GitHub #126](https://github.com/danirukun/opensekai/issues/126)
- [x] LIVE-02 — Actual Add actions for VMC, iFacialMocap and MediaPipe assets. [GitHub #127](https://github.com/danirukun/opensekai/issues/127)
- [x] LIVE-03 — Mixed VMC Body and iFacial Face driven by real loopback UDP mocks; zero invalid packets and changed OBS pose. [GitHub #128](https://github.com/danirukun/opensekai/issues/128)
- [x] LIVE-04 — Actual custom camera creation, lens edit and scene-derived Output selection at6d44c4a. [GitHub #129](https://github.com/danirukun/opensekai/issues/129)
- [x] LIVE-05 — Actual copied production URL renders clean transparent avatar output in OBS. [GitHub #130](https://github.com/danirukun/opensekai/issues/130)
- [x] LIVE-06 — Bundled MediaPipe webcam inference, owner activation, assignment and Stop. Measured inference is separate from render CPU. [GitHub #131](https://github.com/danirukun/opensekai/issues/131)
- [x] LIVE-07 — Current authored-scene MCP capture has registered source metadata and verified resource hash. [GitHub #132](https://github.com/danirukun/opensekai/issues/132)
- [x] LIVE-08 — Physical iFacialMocap control, user verified as the final step. Native status corroborates accepted traffic from the configured phone; no automated motion or handshake capture. [GitHub #133](https://github.com/danirukun/opensekai/issues/133)

Final source checks at6d44c4a:297unit tests,9integration tests and workspace checks pass. Latest native change passed100Rust tests with1explicit fixture skip. Webcam finger/calibration quality, continuous background webcam capture, scene persistence, Windows, minimum hardware and concert performance remain open.


Live editor controls verified on macOS source7084f4a: type groups, collapse/search, row visibility, sidebar output camera and direct transforms.310unit tests and workspace checks pass. Quaternion rounding and focus handoff regressions are fixed. See [actual UI and OBS evidence](evaluation/live-editor-controls.md).

- [x] LIVE-09 — New VRM imports enable built-in idle; inspector toggle, VMC/iFacial takeover and stale return, clean OBS motion after minimize actions. Actual VRM0 and generated VRM1 rigs verified. Live MediaPipe takeover over idle still needs a detected person. [GitHub #134](https://github.com/danirukun/opensekai/issues/134)

- [x] LIVE-10 — Shared One Euro filtering for VMC, iFacialMocap and MediaPipe; reusable TS API. All 52 named ARKit morph channels supported where present. Selected actual VRM0 facial poses and filtered VMC/iFacial OBS motion checked; MediaPipe smoothing covered by deterministic session tests. [GitHub #135](https://github.com/danirukun/opensekai/issues/135)

- [x] LIVE-11 — Lighter tracking defaults and per-source smoothing inspector. Actual VMC/iFacial tuning under loopback traffic preserves generation and packet counters; bypass, Reset and invalid draft checked. MediaPipe controls checked with camera stopped; sample behavior covered by session tests. [Check](evaluation/tracking-smoothing-controls.md). [GitHub #136](https://github.com/danirukun/opensekai/issues/136)
