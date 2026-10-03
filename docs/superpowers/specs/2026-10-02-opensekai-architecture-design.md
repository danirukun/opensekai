# OpenSekai architecture design

Date: 2026-10-02
State: approved; first-slice implementation started on 2026-10-03
Implementation: scoped macOS smoke and first Warudo-style UI verified; minimum live VTubing slice in progress

## Purpose and scope

Build an open-source 3D VTubing app with broad functional parity with [the Warudo handbook](https://docs.warudo.app/docs). The primary use is a live show in a 3D concert hall with one or two performers. Artists can use Blender or Unity to prepare assets.

Start with macOS. Follow with Windows without replacing the shared core. Keep mobile possible through portable modules and platform adapters. Linux is a future platform investigation. Day-one design must support extension isolation, even if user-installed mods ship later.

This document defines the product architecture. It is not one implementation task. The first implementation plan must cover a small macOS feasibility slice. Each later slice needs its own spec and acceptance checks.

## Decisions and candidates

| Area | Direction | Status |
| --- | --- | --- |
| Desktop shell | Tauri v2 with Rust native services | Selected |
| Rendering | Three.js WebGPURenderer and TSL; WebGL 2 fallback | Selected direction; actual runtime support needs proof |
| Production output | Render in OBS Browser Source; transparent background | Initial approach; performance gate required |
| Editor | Warudo-style separate Scene/Editor windows; Svelte5 shared UI | Selected and first slice verified |
| Simulation | One authoritative session, independent of editor widgets | Required |
| Simulation placement | Dedicated app worker initially | Candidate; background scheduling gate |
| ECS | bitECS for session data; Koota is an alternative | Recommendation; benchmark before final selection |
| Tracking | Receive VMC and iFacialMocap from external apps | Selected first protocols |
| Assets | VRM and glTF/GLB first; versioned runtime asset packages | Selected direction |
| Extension language | JavaScript and TypeScript | Selected |
| Extension isolation | QuickJS in a worker through a capability API | Candidate; resource and isolation gates |
| Graphs | Typed execution core early; visual graph editor later | Selected sequence |
| MCP | Local server in the first feasibility slice | Required |
| Shader compatibility | Approximate selected materials first; full coverage later | Roadmap |
| NDI | Excluded from the current implementation scope | Deferred |

## Runtime boundaries

~~~mermaid
flowchart LR
  Tracking["External VMC / iFacialMocap apps"] --> Native["Rust host: sockets, assets, local service"]
  Native --> Session["Authoritative session: ECS, animation, physics, graph operations"]
  Editor["Tauri editor"] --> Commands["Validated command / query API"]
  MCP["Local MCP adapter"] --> Commands
  Commands --> Session
  Session --> State["Versioned evaluated state"]
  State --> Preview["Editor Three.js preview"]
  State --> OBS["OBS Browser Source renderer"]
  Native --> Assets["Prepared asset service"]
  Assets --> Preview
  Assets --> OBS
  OBS --> Evidence["OBS captures and metrics"]
  MCP --> Evidence
~~~

The Rust host owns network sockets, asset access, local endpoint lifetime, and desktop integration. The session owns scene state, animation mixing, tracking application, physics, and blueprint operations. Renderers own GPU resources and draw evaluated state. The editor owns selection, panels, tools, and interaction.

Renderer clients can use different cameras. They share the same authoritative pose and simulation tick. Do not run separate avatar physics in OBS and the editor. Two GPU contexts still mean duplicate rendering and resource cost. Measure both clients active and provide a low-rate preview.

Start with a dedicated worker in the app. A worker is not proof that macOS continues to schedule it while the host is hidden. If minimized, occluded, or background execution fails the benchmark, move the session into an independent runtime process behind the same API. Do not hide failure with a preview-only result. An independent process needs its own runtime and deployment review before selection.

[Tauri uses platform webviews](https://v2.tauri.app/reference/webview-versions/). Test the actual WKWebView, WebView2, and OBS browser runtime. Desktop Safari or Chrome support alone does not establish app support.

## Commands, identity, and transport

Use stable scene IDs in saved files and public APIs. Keep transient ECS IDs internal. Each accepted edit returns a scene revision. Runtime updates also carry a session ID, simulation tick, monotonic time, and stream sequence. Scene revision changes describe edits; ticks describe evaluated motion.

Provide commands for entity creation, validated property edits, camera selection, asset instantiation, tracking assignment, save/load, and controlled evaluation. Use transactions and expectedRevision for conflicting edits. Return structured errors with codes and affected IDs. UI, MCP, and future extensions call the same operations.

Use Tauri commands or channels for native-to-app control. Events are unsuitable for a large continuous state stream. [Tauri channels](https://v2.tauri.app/develop/calling-frontend/) are designed for ordered data delivery. Measure copying and serialization costs.

OBS loads a local renderer page and prepared assets from a loopback service. Use a WebSocket for state and control. Bind the service to loopback. Use an app-scoped connection token, validate origins, and distinguish renderer, editor, and evaluation permissions. Handle OBS browser-origin behavior explicitly. Do not grant broad native permissions to a remote page.

Send an initial snapshot, then bounded batches of dirty state. Use a documented binary layout for high-rate rig data when the measured JSON baseline needs improvement. Coalesce superseded pose updates. Do not coalesce event triggers. Apply backpressure, reject incompatible versions, and recover through a fresh snapshot after a sequence gap. A reconnect must release stale assets and subscriptions.

Settle animation, expression, retargeting, and spring-bone state in the session. VRM loader utilities must not silently duplicate those updates in each renderer. Interpolation may smooth display between session ticks without advancing authoritative physics.

## Renderer and material strategy

Use Three.js WebGPURenderer with TSL. It can fall back to WebGL 2, but fallback support does not prove equal shader coverage or performance. [The renderer guide](https://threejs.org/manual/pages/webgpurenderer) describes differences from the classic renderer, including shader and post-processing APIs.

Pin Three.js and three-vrm together during implementation. Build VRM 0.x and 1.0 fixture checks for the chosen versions. [three-vrm provides WebGPURenderer integration](https://github.com/pixiv/three-vrm#use-with-webgpurenderer) through its node material support.

First material profiles are glTF PBR and VRM MToon. Add a versioned material descriptor, material adapter registry, and explicit capability report. Prepared assets retain original material names, source parameters, and import diagnostics. Never silently replace a failed material with an apparently successful import.

[lilToon](https://github.com/lilxyzw/lilToon) and [NiloToon](https://github.com/ColinLeung-NiloCat/UnityURPToonLitShaderExample) belong to Unity render pipelines. Port their behavior into web material profiles. Unity shader code cannot be loaded directly by Three.js. Full NiloToon is separate from the public example. Do not promise redistribution of proprietary shader code.

Add selected conversion profiles after the output gate. Report unsupported effects. Full lilToon/NiloToon appearance, advanced passes, and arbitrary shader plugins stay on the roadmap. WebGPU and WebGL 2 profiles require separate evidence.

## ECS and scene scale

Prefer a renderer-independent ECS to keep hot scene updates predictable. [bitECS](https://github.com/NateTheGreatt/bitECS) is the first candidate. Compare it with [Koota](https://github.com/pmndrs/koota) only if the first candidate fails ergonomics or measured workload needs.

[A-Frame](https://aframe.io/docs/1.8.0/introduction/entity-component-system.html) is a valid ECS and Three.js framework. Its DOM and scene ownership bring extra integration decisions for a separate authoritative session, OBS renderer clients, and sandbox API. This is a fit tradeoff, not a claim that A-Frame is inherently slow. Include it in the decision record if the smaller ECS proves insufficient.

Represent a performer as an entity with packed rig and expression state. Do not require an entity per bone. Use components for transforms, cameras, lights, render handles, tracking assignments, animation, and show controls. Keep static hall geometry out of the per-frame update loop.

ECS does not reduce draw calls by itself. Use [instancing](https://threejs.org/docs/pages/InstancedMesh.html), [batching](https://threejs.org/docs/pages/BatchedMesh.html), culling, LOD, compressed textures, and explicit shadow budgets. Preserve edit and selection IDs when batching geometry. Avoid per-frame allocations and full scene-tree scans. Profile shadows, transparent overdraw, beams, particles, and video screens before increasing their budgets.

## Assets and authoring

Load VRM and glTF/GLB directly first. Support other Three.js formats through importer adapters with format-specific tests. Loader availability is not an app-level support guarantee.

A runtime asset package contains a versioned manifest, stable IDs, source provenance, geometry, textures, material descriptors, rig metadata, animation clips, and capability diagnostics. Keep the original source separate from the prepared cache. A saved show references prepared asset IDs and versions. Missing assets must remain visible as repairable references.

Build Blender and Unity export paths later. Blender can export glTF plus OpenSekai metadata. Unity can export supported geometry, animation, hierarchy, and material parameters into the same package. Do not require Unity to run the app. Unity AssetBundles and .warudo archives are not first-release interchange formats.

Prepare large assets away from the interactive rendering loop. Support cancellation, progress, bounded memory, deduplication, and cache invalidation by source hash plus importer version. Store reusable optimized output without destroying artist source files.

## Tracking and performer control

Receive VMC over OSC/UDP and iFacialMocap network data from other apps. The first slice does not perform webcam, phone, or hardware tracking itself.

Keep protocol decoders separate from a normalized tracking sample. Samples contain source ID, receive time, source timestamp when available, coordinate metadata, skeleton rotations, root pose, expressions, and validity. Use schema validation and bounded packet size. Ignore unsupported packets with counted diagnostics.

[VMC](https://protocol.vmc.info/english.html) supplies humanoid pose and blend-shape messages. Preserve blend-shape apply boundaries. Handle coordinate conversion, expression mapping, and VRM rest-pose differences explicitly. Do not assume every sender uses the same cadence or optional packets.

[iFacialMocap documents multiple message formats and UDP/TCP modes](https://www.ifacialmocap.com/for-developer/%E6%97%A5%E6%9C%AC%E8%AA%9E/). Select and test the first supported mode in the tracking slice contract. Normalize coefficient ranges and angle units. The app sends only protocol setup messages when required; it does not own camera inference.

For each performer, assign body and face sources independently. Support calibration, offsets, smoothing, loss detection, reconnect, and neutral hold/fade behavior. Prevent one source from applying to both performers by accident. VMC transmission is a later feature.

## Blueprint and animation core

Build typed operations and a bounded scheduler before the visual graph editor. Nodes have versioned types, typed data ports, flow/event ports, settings, and serialization. Built-in operations call the command/session APIs.

Compile graphs into an execution representation. Reject unbounded immediate cycles. Explicit delay/state nodes can cross ticks. Bound event queues and execution time. Define deterministic replay behavior for tests. User expressions must use a restricted evaluator, not host JavaScript eval.

Add the graph editor after scene manipulation and the performance foundation are stable. It must support selection, connections, search, validation, grouping, import/export, and useful error locations. Reuse the runtime format through the editor.

Support animation layers, masks, transitions, expressions, IK, look-at, and attachments in later slices. Keep high-rate animation and physics in built-in systems. Sandbox calls must not become one call per bone per frame.

## JS/TS extension boundary

Define an extension manifest and a versioned host API from the start. Guest code can register node definitions, commands, asset adapters, and approved controls through explicit capabilities.

QuickJS through [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) is the first sandbox candidate. A worker provides scheduling isolation; the guest VM and the exposed host API provide access control. Validate interruption, memory limits, hostile loops, and leaked handles before claiming sandbox support.

Transpile TypeScript before guest execution. Guest code receives copied or serialized data. It has no direct DOM, mutable ECS buffers, Object3D objects, filesystem, network sockets, or Tauri invoke access. Expose selected services through capabilities with time, memory, message, and operation quotas.

Disable a failing plugin, release its registrations, preserve the show, and report the cause. Trusted built-ins can use engine internals. Untrusted plugins cannot use that same route. Initial shader extension support is declarative material profiles. Arbitrary GPU program and native plugin execution require later designs.

## Editor experience

Use a compact tool workspace familiar to Blender, Unity, and OBS users.

- Center: viewport with scene selection, gizmos, camera tools, and output preview.
- Left: scene hierarchy with search, parenting, visibility, and selection.
- Right: context inspector with transforms and type-specific properties.
- Bottom: asset browser and optional diagnostics; graph and animation docks arrive later.
- Output controls: explicit active camera, output status, resolution, and OBS connection.

Support resizable docks and saved layouts. Use one selection model across hierarchy, viewport, inspector, and graph. Add undo/redo for edits and clear separation between persistent edits and live tracking. Provide common shortcuts, drag/drop imports, and repairable errors.

Avoid decorative card grids and duplicate helper copy. Prefer direct manipulation and short labels. Keep diagnostics in tools, not in routine product flow. The first slice proves a small edit-to-output path; it does not build the complete docking system.

## MCP and model evaluation

MCP is part of the first feasibility slice. A local stdio adapter connects to the same command/query API as the UI. Start with status, scene inspection, camera selection, controlled property edits, diagnostic capture, and benchmark run/status operations.

Expose opaque resource references for assets and captures. Do not expose arbitrary shell execution or arbitrary filesystem access. Use edit revisions and permission scopes. Keep logs on stderr for stdio transport. Choose and pin the current official SDK during planning.

The [MCP evaluation design](../../evaluation/mcp-evaluation-design.md) defines the proposed tool surface and evidence. Frontier models can assess appearance, alpha, UI clarity, and regressions from controlled captures. Numeric timing and loss thresholds determine benchmark results. A model score alone cannot establish performance.

Use OBS WebSocket for repeatable scene/source setup, screenshots, stats, and local test recording. The development endpoint is ws://127.0.0.1:4455 without authentication, as supplied by the user. Computer-use is available for UI behavior and visual inspection that WebSocket does not cover.

## Performance and failure gates

The main target is 1080p60 with a representative concert hall and two performers. Run a one-performer comparison. An M1-class Mac is the proposed minimum tier; the current M3 Pro development machine cannot prove that tier. A mid-range Windows GPU is a later target, with an exact reference model selected before testing.

The [benchmark contract](../../evaluation/benchmark-contract.md) defines evidence and proposed thresholds. Freeze a real scene manifest before using a result for acceptance. Test OBS alone, editor preview plus OBS, editor minimized, reconnect, camera cuts, and a long session.

The VCheki experience showed that image readback, encoding, and IPC can dominate output cost. Use it as a risk, not as a timing estimate for this renderer. The initial OBS renderer sends state and loads assets; it does not receive a per-frame image stream. Diagnostic screenshots are bounded exceptions.

Gate the exact production path before investing in broad parity. If browser output, shader compatibility, or app background timing fails, record the result and revise the failing boundary. Native output may become a later adapter. It is not assumed to be available from a Tauri texture today.

## Persistence and recovery

Save shows in a versioned, portable format with stable IDs and asset references. Validate before applying. Use atomic file replacement, explicit migration, and a recovery copy. Reject a newer unsupported schema without damaging the file.

On tracking loss, apply the documented performer fallback. On renderer loss, the session continues and a returning client receives a snapshot. On session failure, expose an actionable error and preserve the saved show. Do not report stale frames as healthy output.

## Slice sequence

1. macOS feasibility: Tauri shell, one scene command API, WebGPU/fallback probes, small VRM scene, transparent OBS rendering, early MCP, captured metrics, minimized-host behavior.
2. Concert foundation: frozen hall fixture, two performers, ECS selection, material/asset preparation, lighting budgets, camera replay, full performance gate.
3. Tracking and editor usability: VMC, iFacialMocap, performer assignment, scene edits, save/load, undo/redo, repair flows.
4. Show behavior: animation, physics, props, screens, audio controls, graph core and visual editor.
5. Extension delivery and authoring tools: sandbox validation, JS/TS SDK, format adapters, Blender/Unity exports.
6. Broader parity and platforms: advanced materials, further tracking protocols, production integrations, Windows validation, future mobile experiments.

Tracking, editor, and MCP implementation can overlap with renderer work after contracts exist. The exact dependency graph, task size, reasoning effort, and checkpoint commands belong in the next implementation plan. Full parity is not a prerequisite for the first useful build.

## Acceptance and review

A slice is complete only after its spec checks pass, the running path is verified, and the parity checklist cites evidence. Documentation does not mark a feature implemented. Integration tests must explain the real boundary they cover. Unit tests cover new logic. Visual changes need app and OBS checks as appropriate.

This design records the selected directions and the unproven candidates. The [macOS implementation plan](../plans/2026-10-02-opensekai-macos-feasibility.md) defines the first slice. Review that plan before implementation.

## User minimum update — 2026-10-03

Prioritize local VRM import, receiver/tracker assets, mixed VMC/iFacial avatar control, camera authoring, OBS and MediaPipe before the concert foundation. See [minimum live VTubing plan](../plans/2026-10-03-minimum-live-vtubing.md). MediaPipe is now an early deliverable; the earlier external-only tracking sequence is historical. Full shaders, NDI, Windows and concert acceptance retain their separate scope.
