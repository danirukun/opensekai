# Minimum live VTubing implementation plan

> For agentic workers: use the preserved parallel agent method, lower effort after interfaces are stable, and separate worktrees. Apply subagent-driven development for implementation and independent reviews.

**Goal:** Import and control a VRM from receiver/tracker assets, edit a camera and use the scene in OBS.
**Architecture:** Native file/socket adapters feed one session. MediaPipe inference runs in a separate worker. Both renderers consume the same evaluated pose.
**Tech stack:** Tauri2/Rust, Svelte5/shared Oshi UI, three.js180/three-vrm3.4, bitECS and pinned MediaPipe Tasks.
**Spec:** spdd/prompt/2026-10-03-minimum-live-vtubing.md.

## Global constraints

64 entities,4 sources,2 avatars;128MiB import;16MiB GLB JSON;8KiB UDP;64 bones/expressions;64KiB credited clock;500ms freshness plus250ms fade;30Hz maximum inference with one active and one pending image. No camera/model bytes through Tauri IPC. No guest native privilege expansion. Preserve source attribution and OBS.

## Review focus

- A VRM0 imported model must face the camera and retain its own bone/expression bindings.
- VMC body and iFacial face must mix by assignment, with staged blend values and correct handedness.
- Disabled/stale/rebound sources must release state; late callbacks must not revive them.
- Large import, malformed GLB/OSC and a port conflict must return useful errors without losing the scene.
- Camera/WASM permission and lifecycle errors must stay visible; fake inference cannot count as real webcam evidence.

## Task1: Shared authoring/tracking contract — root

Files: packages/contracts/src/{types,schema,tracking}.ts and tests; crates/contracts/src/{lib,tracking}.rs and tests; shared vector fixtures.
- [ ] Add RED tests: createEntity duplicate/reference validation, lens limits, config kinds, finite bounded tracking samples, backward-compatible no-pose frame/clock.
- [ ] Add the exact types and operations from the slice contract. For example scenePatch operations [{kind:'createEntity',entity:camera}] return one revision; invalid far<=near fails before transport.
- [ ] Mirror schema/validation in Rust. Test the serialized clock tracking object in both languages.
- [ ] Run pnpm test:unit and cargo test -p opensekai-contracts; commit stable interfaces and release lanes.

## Task2: Native import and receiver runtime — native lane

Files: apps/desktop/src-tauri/src/assets/{import,registry}.rs; tracking/{manager,vmc,ifacial,mod}.rs; service/mod.rs; bootstrap.rs/lib.rs; scoped capabilities/build declarations; tests.
Consumes: TrackingConfig/Sample/Status/Update and SceneEntity::Tracking; produces editor-only import_avatar -> Option<ImportResult>, dynamic asset registration and optional tracking on existing credited Clock.
- [ ] RED GLB size/URI/metadata and native file-boundary tests; RED OSC truncation/depth/BlendApply and iFacial degree/delimiter/weight tests.
- [ ] Implement off-thread streamed import, atomic managed registration and path-free return. Preserve explicit fixture mode; normal startup creates an empty library and succeeds without fixture env.
- [ ] Implement latest-snapshot UDP manager with generation-safe rebind/stop and precise status. Test real loopback datagrams, stale state, bind conflict and shutdown; no arbitrary UDP command execution.
- [ ] Reconcile persistent source configs and attach snapshots to Clock within its credit limit. Expose source status through latest evaluated frame.
- [ ] Run focused Rust tests/strict Clippy, checkpoint, independent review.

## Task3: Avatar renderer bindings — renderer lane

Files: packages/renderer/src/{assets,renderer,avatar-pose}.ts and scoped tests.
Consumes RuntimeFrame.avatarPoses and tagged TrackingBone; produces retained per-avatar rig/expression application.
- [ ] RED known rotations, VRM0 orientation, expression alias/reset and two-instance isolation checks.
- [ ] Retain each avatar's VRM rather than using a cached original rig on its scene clone. Keep mesh reuse separate. Example raw head [0,sin(a/2),0,cos(a/2)] must affect only the requested avatar; normalized identity must return to rest.
- [ ] Apply normalized then raw pose and expressions; skip tracking source entities. Keep disposal and preview-only gizmo rules.
- [ ] Run renderer checks/tests, checkpoint, independent review.

## Task4: Asset and type-specific properties — UI lane

Files: Hierarchy.svelte, Inspector.svelte, CameraLensFields.svelte, AvatarSourceFields.svelte, TrackingSourceFields.svelte, editor/live-fields.ts and tests.
Consumes SceneEntity tracking union; callbacks onadd(kind), onimport(), onTrackingConfig/config changes and root model authoring methods.
- [ ] RED pure finite lens/config/source-option and equal-revision draft tests.
- [ ] Add compact Add menu and Import button. Source assets use one selection model, have no transform tools and show Start/Stop plus actual status. Receiver endpoint changes preserve drafts until Apply.
- [ ] Add Body source/Face source selectors and camera FOV/Near/Far properties. No duplicate explanations or unsupported buttons.
- [ ] Run UI checks/tests, checkpoint, independent review.

## Task5: Authoritative authoring and source composition — root

Files: packages/session/src/{session,ecs,tracking,worker}.ts; browser-client/client.ts; editor/model.ts; bootstrap.ts; EditorApp/App.svelte; scoped tests.
- [ ] RED atomic create/config/lens/assignment and dynamic ECS tests. Creating a source/avatar/camera must register its stable ID and emit an inspectable revision.
- [ ] Implement scene patches against a validated candidate. Source references must point to compatible tracking kinds; failed transactions preserve the scene.
- [ ] RED body/face ownership, exact native time-domain freshness, stale fade, disabled/config replacement and revision-stable pose tests.
- [ ] Implement latest-sample composition. Forward optional native tracking with onClock, and local MediaPipe messages to the same session. Root/pose never changes stored avatar transform.
- [ ] Compose native import, Add/selection/status and default empty scene. Preserve smoke-mode scene only when explicit fixture mode is present. Run workspace and boundary checks, checkpoint.

## Task6: MediaPipe local inference — tracker lane after contracts

Files: desktop tracking/{mediapipe,mediapipe-worker,retarget,lifecycle}.ts; model asset notices/manifest; scripts/prepare-tracking.ts; package versions and native camera config owned by root.
Produces normalized TrackingSample/TrackingStatus callbacks from an explicit webcam Start action. Root wires them to worker messages.
- [ ] RED known face yaw/blink/jaw, asymmetric upper-body/hand landmarks, mirroring and degenerate input math tests.
- [ ] RED one-active/one-latest disposal and Start/Stop generation tests; denial/missing-device must not become receiving.
- [ ] Bundle pinned local WASM/task models with hashes and notices. Use CPU fallback when GPU unavailable. Verify release-origin worker model loading with actual binaries.
- [ ] Implement bounded frame transfer/inference and close every owned image/track/model. Measure inference separately from render timing.
- [ ] Run scoped checks/tests; verify actual camera only after permission and record limitations explicitly. Checkpoint and independent review.

## Task7: Actual app and OBS acceptance — root

- [ ] Build current release with embedded source, launch without fixture env, import the user model in the native chooser, inspect actual avatar and type-specific UI.
- [ ] Create both receivers and a custom camera through UI. Inject real loopback VMC+ifacial packets, select body/face sources, and compare changing bones/morphs and camera output in app/OBS.
- [ ] Add and start MediaPipe; verify local binaries, lifecycle and normalized pose path. Test physical webcam/phone when available; ask for connection details if needed. Keep simulated and real evidence separate.
- [ ] Check stale loss, stop/restart, invalid lens, port conflict and editor minimization. Run a focused large-avatar rendering check without claiming concert certification.
- [ ] Save registered captures, hashes, source IDs and device/mock status; update minimum-deliverable table and Warudo parity, clean owned OBS sources and commit checkpoint.
