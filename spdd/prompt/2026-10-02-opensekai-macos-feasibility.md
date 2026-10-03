# REASONS: macOS feasibility slice

Date: 2026-10-02. State: approved for implementation on 2026-10-03; feasibility evidence pending.

## R — Requirements

F1. Launch a Tauri v2 app on macOS with a working Svelte 5 editor.
F2. Initialize WebGPURenderer with MToonNodeMaterial and record the actual backend. Force WebGL 2 in a separate run.
F3. Deliver transparent 1920 × 1080 OBS Browser Source output at a configured 60 FPS. Record actual frame delivery; do not claim concert acceptance.
F4. Use one session worker for a deterministic smoke scene. Verify continuing motion while minimized. Fail the slice if the worker path freezes.
F5. Use stable scene IDs, schema version 1, edit revisions, session ticks, and client acknowledgements.
F6. Load a self-contained GLB and at least one real VRM. Verify VRM 0.x and 1.0 separately before claiming both. Keep asset licenses and hashes.
F7. Support scene inspection, atomic transform/visibility edits, and camera selection through the same API for UI and MCP.
F8. Add MCP v2 stdio tools in this slice: status, inspection, patch, camera, capture, benchmark start/status/cancel, and evidence read.
F9. Add bounded diagnostic PNG captures and a fixed smoke replay benchmark. Correlate actual OBS screenshots with rendered state.
F10. Recover from renderer reconnect, stale edits, missing assets, oversized messages, and cancelled evaluation runs.
F11. Keep renderer and guest capabilities separate from operator/native capabilities. Guest code execution is outside this slice.
F12. Run independent agents at lower effort after shared contracts exist. Keep separate worktrees and verified checkpoints.

## E — Entities

SceneView, SceneEntity, AssetRecord, OutputSpec, RuntimeFrame, FrameApplied, ScenePatch, ConnectionDescriptor, AppError, CaptureRecord, BenchmarkRun, EvidenceManifest, and Capability.

The [plan](../../docs/superpowers/plans/2026-10-02-opensekai-macos-feasibility.md) defines exact fields and signatures. Saved-show migration is outside this live prototype.

## A — Approach

Rust binds a loopback HTTP/WebSocket service on an ephemeral port. The editor receives scoped credentials through Tauri bootstrap. A dedicated worker connects as the sole publisher. OBS connects as a renderer. MCP connects as an operator with explicit evaluation capabilities.

The session owns persistent edits and deterministic evaluated motion. The native service relays commands and state and owns evidence/evaluation resources. Renderers update GPU objects from evaluated frames. No physics or independent motion generator runs in either renderer.

Start with full JSON frames for the small fixture. Cap queues and bytes. Measure transport before selecting a binary layout for larger rigs. Start bitECS behind an adapter. No ECS performance claim is made by this slice.

## S — Structure

A pnpm workspace contains desktop, output, and MCP apps; contracts, session, renderer, and browser-client packages; and an evaluation tool package. A Rust workspace contains the desktop native crate, shared contract types, and evaluation logic.

Public schemas have JSON fixtures shared across Rust and TypeScript tests. The integrator owns root manifests and lockfiles. Lane ownership is specified in the plan.

## O — Operations

1. Establish pinned tooling, shared UI snapshot handling, and a runnable desktop shell.
2. Freeze command, transport, asset, and evidence contracts with cross-language fixtures.
3. Build the native service, session worker, and renderer in independent lanes.
4. Integrate a current moving scene in OBS.
5. Build editor controls, MCP, and evaluation logic in independent lanes.
6. Wire evidence/evaluation services and run actual macOS acceptance.
7. Update scoped parity entries and checkpoint evidence.

## N — Norms

Apply [the constitution](../../docs/constitution.md) and [project instructions](../../AGENTS.md). Use pnpm, functional TypeScript, and shared UI primitives. Unit-test new function behavior. Use integration tests at actual WebSocket, stdio, and file boundaries with a stated reason. Verify the running editor and OBS output.

Source and evidence updates travel with each verified feature checkpoint. The implementation plan contains test examples and exact commands. Root dependency pins change only through the integrator.

## S — Safeguards

- Bind local services to 127.0.0.1, validate Host/Origin, authenticate roles, and deny renderer edits.
- Bound frames at 256 KiB, queued state at two frames per client, pending calls at 32 per client, and request time at 2 seconds.
- Bound diagnostic captures at 2 MiB PNG, one per second per client, and eight retained in-memory records.
- Run one smoke benchmark at a time. Preset: 30-second warmup and 120-second measurement. Permit cancellation.
- Return explicit errors for invalid input, revisions, role violations, unsupported features, timeouts, and missing evidence.
- Do not write secrets, private paths, or source asset bytes into committed evidence.
- Test client acknowledgement separately from actual OBS presentation.
- Mark unavailable GPU timing as unknown. Measure capture-free performance windows.
- No live streaming, public publication, NDI integration, full shader conversion, or guest plugin execution in this slice.
- If minimized-session behavior fails, record the failed gate and write the independent-runtime follow-up spec before proceeding to concert acceptance.

## Execution rulings

2026-10-03: Keep svelte-check 4.7.6. Use an exact published TypeScript 6.x version because the checker peer range excludes TypeScript 7.0.2. Record the selected version and metadata in docs/dependencies.md before the first parallel wave. Do not suppress peer checks.

## Wire envelope contract v1

Task 2 must export strict schemas and a WireMessage union for these JSON forms. All names are literal. A native client can omit the WebSocket Origin header, but must authenticate before all other messages. Authentication failure closes the connection; it is not a successful authReply.

```ts
type WireMessage =
  | { kind: "auth"; role: ConnectionDescriptor["role"]; token: string;
      schemaVersion: 1; outputId: Id | null }
  | { kind: "authReply"; sessionId: Id; schemaVersion: 1;
      capabilities: Capability[] }
  | Call
  | { kind: "reply"; requestId: Id; result: Reply<unknown> }
  | { kind: "frame"; frame: RuntimeFrame }
  | { kind: "applied"; frame: FrameApplied }
  | { kind: "captureRequest"; requestId: Id; params: CaptureParams }
  | { kind: "captureReply"; requestId: Id;
      result: Reply<{ metadata: { frame: FrameApplied; width: number; height: number };
        pngBase64: string }> }
  | { kind: "ping" | "pong"; requestId: Id };
```

The reply envelope has a method-specific result schema selected from the pending request. Rust uses the same field names with serde camelCase. Rust can store result data as serde_json::Value, but must validate incoming method results before relaying them. Requests sent to the publisher include the validated Call. Request IDs are scoped to their connection; the native relay allocates distinct internal request IDs and restores the caller's original ID on reply. This prevents callers with equal request IDs from receiving each other's replies.

A successful captureReply carries the metadata and PNG bytes for one displayed frame. An error uses the same Reply error form as command replies. The separate encoded capture limit applies to this envelope only. Each diagnostic capture is serialized with applyFrame so its metadata matches its pixels.

Native evaluation callbacks receive RpcContext { client_id: String } from the authenticated connection. It is internal metadata, never a wire field or caller-supplied parameter. Use it for per-client capture limits. ServiceHandle::now_ms returns the same monotonic clock origin used for acknowledgement timestamps. This prevents capture freshness checks from comparing unrelated clocks.

## Local asset manifest contract

The native configuration file is ignored local data. Its JSON shape is { schemaVersion: 1, fixtureId: "smoke_v1", assets: [{ record: AssetRecord, path: string }] }. Each path is an absolute file path below the configuration file's parent directory. Resolve and check canonical paths before access; reject an escaping symlink. The tracked smoke manifest contains schemaVersion, fixtureId, and an AssetRecord array without paths. Source terms and source revision belong in its source-policy.md. Native services and renderer tooling must use these exact shapes.

For native lane testing, permit only pub mod service and pub mod assets declarations in lib.rs before Task 6. This exposes the actual modules to crate tests without starting or wiring the service into Tauri. Startup integration remains Task 6.

Wire validators in both languages accept integral JSON numeric forms such as 1, 1.0, and 1e0 for safe nonnegative counters. Rust normalizes integral JSON values before typed decoding. Descriptor comparison uses normalized URL authority, not original string spelling. Capability lists must be unique and authentication grants must match the descriptor exactly.

### Early MCP implementation order

The MCP worker can implement Task 8 against the frozen AppApi, operator descriptor, and authenticated resource client before Task 6 is complete. Its unit tests and real stdio fixture use the frozen boundary. Merge and live application acceptance still depend on Task 6. This order lets the early MCP work run while native and renderer reviews finish. It does not grant extra capabilities.

### Evidence resource URI mapping

Capture resources use opensekai://evidence/<opaque-id>/capture.png. Benchmark summaries use opensekai://evidence/<opaque-id>/summary.json. BrowserClient.readResource maps these canonical URIs to authenticated service /evidence/<opaque-id>/<filename> requests. It rejects query, fragment, credentials, port, unknown authority, path traversal, and unsupported file names. The MCP server passes registered public URIs to this client. The native endpoint serves only registered records; it does not derive a filesystem path from an ID. Expired or unknown records return NOT_FOUND. The integrator adds the client mapping and native route in Task 10.

### Slow renderer acknowledgement recovery

A renderer can complete a delivered frame after its provenance leaves the bounded published-frame history. Ignore an acknowledgement whose sequence is older than the retained history after checking its session and output scope. Do not add it to the verified acknowledgement ring or mark the output ready. Future sequences and mismatches against retained provenance remain errors. This policy keeps asset initialization from causing a false disconnect. A network regression must verify recovery to fresh state on the same connection.

### Continuous canvas presentation

Do not assign canvas dimensions on every frame. Set the renderer size only when the requested physical width or height changes. A same-size frame must preserve the backing buffer configuration so the OBS compositor can sample rendered pixels. Verify continuous presentation separately from a one-frame PNG capture.

### Readiness requires a fresh output

AppStatus.ready requires a connected output_main with a verified acknowledgement received within 500 ms on the native clock. The acknowledgement must match the current session and edit revision. Retain lastFrame metadata for diagnostics after this deadline, but report ready false. Preview alone cannot make the app ready.

### Desktop integration backend probe

bootstrapDesktop accepts the preview canvas. Trusted NativeBootstrap includes rendererMode (auto or force-webgl2). OPENSEKAI_RENDERER_BACKEND=webgl2 selects the forced mode for preview and the copied OBS URL. Otherwise use auto. This local launch option allows separate macOS backend checks without changing public extension or wire contracts.

### Frame delivery backpressure

The native renderer connection keeps at most two unacknowledged state frames in flight, in addition to its latest-two pending state queue. Retain provenance for those delivered frames until an acknowledgement releases their slots. A verified acknowledgement for a newer delivered sequence releases all older slots, because the renderer can coalesce state. Do not send more state until a slot is free. Continue to receive control traffic while waiting. Keep control messages in their separate bounded queue. This bound extends to the TCP/browser ingress frontier; a bounded Rust queue alone is not sufficient. Obsolete ACKs with no retained delivered or published provenance are ignored after scope checks.

Browser publisher state sends use the encoded frame size to limit queued state bytes to approximately two frames, within the global byte limit. A failed control or reply send must close the current socket so callers receive UNAVAILABLE and the existing authenticated reconnect path can recover. Do not silently discard a reply. Do not replay mutations.

The trusted desktop bootstrap result also exposes registered AssetRecord values to the editor composition. Embedded GLB images load through ImageBitmapLoader fetch requests to local blob URLs, so the desktop connect-src includes blob:. Remote network origins remain excluded.

The projected two-frame byte bound applies to state only. Control payloads retain the ordinary 256 KiB or capture reply 3 MiB limit. A control send with more than 512 KiB already buffered closes the current socket; a legal capture reply can exceed 512 KiB.

### Independent implementation after the source checkpoint

Tasks 7 and 9 can implement their bounded editor and evaluation modules from the reviewed Task 6 source checkpoint. Their unit and process-boundary checks do not depend on final visual acceptance. Live integration and acceptance remain ordered after the Task 6 checks. Shared interfaces and dependencies remain with the integrator.

### Renderer camera lifetime correction

The renderer must reuse one PerspectiveCamera for its output. Apply the selected camera transform and lens on each frame. Three.js render contexts and light lists use scene and camera identity. A new camera on each frame rebuilds those resources and invalidates the performance assumptions. Verify stable camera identity and changed lens/selection in a unit regression. Repeat the live output check before claiming performance.

### Evaluation integration boundary

Task 6 debug output has current motion, camera changes, correct textures, and transparent background pixels after the retained-camera correction. Source integration of the reviewed editor, MCP, and evaluation modules can proceed. Release launch and the timed minimized gate remain required before acceptance.

Native evaluation uses a cloneable ServicePorts wrapper around service state. It does not own the server shutdown handle. Evaluation callbacks and the HTTP evidence reader capture Weak<NativeEvaluation>. DesktopState owns evaluation and shuts its timer down before service shutdown. One 100 ms timer reads all new validated ACKs from the bounded native ring in sequence order and passes each native receive time to RunManager. It then updates status with current native time. Sampling only the latest ACK would give false frame interval measurements.

Evidence HTTP routes accept only the operator bearer credential, an exact registered opaque ID, and capture.png or summary.json. CORS uses the existing exact Origin allowlist. Public opensekai URIs map to these routes; relative paths, user information, ports, encoded IDs, queries, and fragments are rejected. Retention expiration removes resource access even if an old exported file remains. Native exports use an app-owned confined directory and atomic replacement.

Benchmark start verifies the registered smoke fixture asset IDs, hashes, and bytes against fixtures/smoke/manifest.json and checks a connected current output_main ACK with matching backend/revision. Capture and benchmark timing cannot overlap. UTC formatting uses the already locked chrono 0.4.45 with a direct exact dependency. Build metadata must identify the Git source revision.

Evaluation decoder safeguard: Before PNG decode, validate a bounded chunk stream. Require exactly one first IHDR with 13 bytes, dimensions at most 1920 by 1080, no interlace, bounded chunk lengths, and one final IEND with no trailing bytes. Reject duplicate IHDR chunks before the codec reads them. Benchmark evidence must use the exact canonical URI for the requested run. The manifest ID and parsed summary run ID must match that run. Check fixture, profile, and session metadata where available. Composition checks must correlate revision, camera, tick, and native freshness within 500 ms, or report the correlation as unknown.

Bootstrap lifecycle safeguard: DesktopState owns NativeEvaluation only when evaluation is enabled. Install it with the actual service session, fixture identity, source revision, and app data evidence directory. Stop its timer before service shutdown. Concurrent shutdown callers must wait for the same completed teardown. A startup that loses the shutdown race must stop both resources.

Task 11 driver contract: Accept explicit --profile webgpu_smoke_v1 or webgl2_smoke_v1 and --repeats 1 or 3. Preserve environment profile selection for existing use. Reject differing argument/environment profiles and invalid or duplicate options. Use native intervalMs.max for the 100 ms maximum-stall check when that finite nonnegative metric is present. Preserve unknown for missing metrics. Record the actual OBS counter interval and do not widen the 120-second measurement gate to hide polling delay.

Task 11 diagnostics contract: Keep FrameApplied, AppStatus, and AppApi unchanged. Evaluation output can send one strict diagnostics envelope after a successful render, at most once per second. The packet has sessionId, outputId, rendererEpoch, sequence, revision, backend, geometries, textures, liveMaterials, assetCacheEntries, activeRenderJob, queuedFrames, and queuedCaptures. Require at most 2 KiB encoded bytes, bounded IDs, finite safe nonnegative integer counts at most one million, and Boolean activeRenderJob. Geometry and texture counts come from renderer.info.memory. liveMaterials counts unique reachable material objects; it is not a GPU allocation count. Native code accepts renderer packets only with current connection/output/session and acknowledged frame provenance. Keep one packet per active renderer, enforce the rate, and clear it on disconnect.

An evaluation-only GET /diagnostics/<outputId> requires the operator bearer, exact Host/Origin, no query, and an exact bounded output ID. Return the last renderer packet with native receipt age and bounded native queue counts. Include state frames, delivered unacknowledged frames, controls, pending calls per owner, and ACK history. Do not read images or GPU pixels. Move blocking snapshot work off the async network thread. During soak, record settled baseline and counts after five reloads. Do not claim old renderer epoch GPU destruction from equal new-epoch counts alone; require teardown tests and a process memory trend, or label cross-epoch cleanup unknown.

Composition acceptance correction: A current native ACK can be newer than an OBS composition pixel sample. Do not classify that presentation race from AppStatus alone. Outside the measured window, wait at least one second between diagnostic captures, obtain a bounded native capture with maxAgeMs 500 before each dark/light/checker screenshot, and correlate its metadata with the actual composition marker. Record each capture ID. Keep all captures outside benchmark measurement and retain the original strict session/camera/revision/tick/500 ms rules. Native validated capture supplies freshness; AppStatus alone remains insufficient.

Minimized scheduling correction: Formal run 05c0e0cc-4cd4-4d73-b810-d27b05dc8ee0 at app source 75de982 failed the 100 ms maximum interval gate (122 ms, interval p95 111 ms) during accurately scheduled 30/45/45 phases. Check the installed Tauri/Wry inactive scheduling configuration before changing the session clock architecture. Set the main window backgroundThrottling policy to disabled and repeat the real minimized gate. Tauri maps this to the public WKInactiveSchedulingPolicyNone API on macOS 14 or later. The macOS slice minimum OS is 14.0 so this required policy cannot be silently ignored on older systems. This policy is not implemented for Windows, Linux, or Android; keep their background scheduling acceptance pending. The preview remains capped at 15 FPS and half resolution. Do not weaken the 100 ms gate or count the failed run as passed.

### Native wakeup clock correction

Run 9338c8b1 at source 953ab9b also failed (maximum interval 121 ms, p95 111 ms). The public WebView policy does not establish worker timer performance. A real 20-second minimized diagnostic showed publisher sequence increases of 9–10 per second while elapsed ticks increased by about 60. A bounded read-only WebSocket wake experiment kept sequence increases at 56–59 per second while minimized. Replace only the worker wakeup source. JavaScript remains authoritative for scene evaluation and persistent edits. Do not move scene logic to Rust or use a WebView timer fallback.

Add a strict internal wire envelope { kind: "clock", sessionId: bounded ID, elapsedMs: safe nonnegative integer }. Mirror it in TypeScript and Rust, with the same 2 KiB encoded limit. Native code sends it only to the authenticated publisher. Reject injected clock packets from clients. Browser clients reject clocks for the wrong session or role. The publisher client exposes onClock(listener), with unsubscribe and close cleanup. All other public contracts, including RuntimeFrame, FrameApplied, AppStatus, and AppApi, remain unchanged.

Use the service monotonic clock and a 60 Hz Tokio interval with MissedTickBehavior::Skip. Give a due pulse fair service even when control traffic stays active. Keep at most one unconsumed clock pulse across the Rust, socket, and browser ingress boundary. The next validated publisher frame releases that pulse credit. An unsolicited frame remains compatible with existing service tests, but it cannot accumulate clock credits. Release and notify the writer only after ordinary session and increasing-sequence frame validation. If a pulse does not receive a frame within 2 seconds, close that connection and allow authenticated reconnect. Check that deadline during sends and while idle. Stop and shutdown must interrupt pending writes. Keep clock payloads small; do not put them into the ordinary control queue. There are no queued or catch-up clock pulses.

The worker uses the first clock elapsedMs as its origin, including zero. It retains that origin and last accepted clock across reconnects for the same session. Ignore duplicate or regressing clock times. One accepted pulse produces at most one evaluated frame from current elapsed time. Stop, failed subscription, late startup, and restart must unsubscribe and close exactly once. Generation checks prevent late callbacks from publishing. Remove the worker timer and its timer ports. Keep persistent edits on the same worker and never replay mutations.

Before merge, require strict cross-language clock vectors and unit regressions for first zero, duplicate/regressing times, stop/restart, failed subscription, and late connection startup. At the real native WebSocket boundary, verify publisher-only delivery, rejection of injected clocks, fair clock progress under sustained controls, one outstanding pulse for a blocked publisher, timeout and shutdown cleanup, and a fresh pulse after frame credit release. Keep the native timer independent of renderer ACK delivery. Repeat the actual 45-second minimized release gate before any acceptance claim. Retain both failed runs as evidence and do not lower thresholds.
