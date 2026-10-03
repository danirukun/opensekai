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
