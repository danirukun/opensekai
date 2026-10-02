# Early MCP and model evaluation

Date: 2026-10-02. State: architecture contract; tool names are proposed.

## Placement

Ship a small local MCP server in the first macOS feasibility slice. Use stdio first and the current official SDK. Pin the SDK and protocol revision during implementation planning.

The MCP adapter connects to the OpenSekai local command API. UI and MCP use the same validation, scene IDs, edit revisions, and error codes. The adapter does not mutate ECS memory or GPU resources directly.

[MCP supports tools, resources, and prompts](https://modelcontextprotocol.io/docs/develop/build-server). Use tools for actions and resources for scene descriptions, metrics, and captured images. For stdio, reserve stdout for protocol messages and use stderr for logs.

## Proposed first tool surface

| Tool | Input | Output |
| --- | --- | --- |
| app_status | Session selector | Versions, capabilities, connection health |
| scene_inspect | Scene ID, optional entity IDs | Stable IDs, scene revision, properties |
| scene_patch | Scene ID, expectedRevision, validated operations | New revision or conflict |
| camera_select | Output ID, camera ID, expectedRevision | Accepted output state |
| capture_frame | Client/output ID, expected revision, capture preset | Capture reference, applied revision, tick, backend |
| benchmark_start | Fixture ID, profile ID, approved run preset | Run ID |
| benchmark_status | Run ID | Progress, summary, evidence references |
| benchmark_cancel | Run ID | Cancellation state |
| evidence_read | Run ID or capture ID | Structured manifest and resource references |

Keep the first scene_patch schema small: selected transforms, visibility, and tested properties. Do not accept arbitrary paths into engine objects.

Long benchmarks return a run ID immediately. Poll or subscribe for results. Support cancellation and cleanup. Start with fixed run presets so agents cannot create an unbounded workload.

Add asset listing/import, graph diagnostics, and more show controls through later slice contracts. Do not require full feature parity before MCP becomes useful.

## Permissions and reliability

Local stdio is the default MCP transport. The adapter receives a scoped session credential for the loopback app service. It starts with read access. Editor/test configuration can grant validated mutation and capture capabilities. Use an explicit evaluation mode for fixture replacement and OBS test setup.

Use opaque registered asset, fixture, and evidence IDs. Do not provide generic shell, unrestricted filesystem, network fetch, or host JavaScript evaluation tools. File import uses the app's registered asset mechanism. Avoid leaking local paths or connection tokens in model evidence.

Check session identity and expectedRevision before mutations. Return conflict, not an implicit overwrite. Use request IDs and document retry semantics. A repeated benchmark_start must not create duplicate runs. Capture requests specify freshness and fail on stale or missing renderer acknowledgements.

Bound capture size, frequency, memory, and queue length. Diagnostics may perform occasional GPU readback. They must not become the production frame-delivery path. Captures and performance runs can perturb timing; label capture activity and separate capture-free timing runs.

## OBS evaluation adapter

The user provided ws://127.0.0.1:4455 with no authentication for current development. It is reachable. This is a local setup fact; future users can configure authenticated endpoints.

Use OBS WebSocket directly for reliable machine control. Use computer-use for interactions and visible checks that the protocol cannot establish. Preserve existing profile and scene settings. Create isolated OpenSekai test sources/scenes and restore selection after a run.

Proposed adapter operations: inspect versions/video settings; configure the owned browser source; select test scene; query source and output status; collect source screenshots and stats; perform local test recording. Keep these behind evaluation capabilities.

The [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md) provides requests, status codes, and negotiated RPC versions. Check available requests instead of assuming that every version supports an operation. Sample cumulative counters at run start and end.

Keep OpenSekai evidence distinct from OBS evidence. A renderer acknowledgement reports submitted state; an OBS capture reports what OBS received. Correlate them with revision, tick, sequence, and capture time. A screenshot from an unrelated OBS source must fail the evidence check.

Handle absent OBS, disconnects, source shutdown, timeouts, and malformed responses as explicit failures. Do not auto-start live streaming. A failed verification must leave the user's existing scene intact.

## Frontier-model evaluation loop

1. Select a fixed fixture, camera schedule, output profile, and rubric.
2. Apply changes through the common API and wait for renderer acknowledgement.
3. Collect app diagnostics, actual OBS captures, and a separate timing run.
4. Supply the evidence packet to the selected frontier model through the user's evaluation client.
5. Record findings, confidence, referenced captures, and proposed changes.
6. Reproduce a finding, make a bounded edit, and rerun the same checks.
7. Save the resulting evidence with the code checkpoint.

OpenSekai does not require a model provider account to render or stream. Evidence generation stays local. The user's client controls any external model submission.

## Evaluation rubric

| Area | Evidence | Result form |
| --- | --- | --- |
| Transparency | Dark/light/checker compositions and raw source capture | Defect locations and severity |
| Avatar appearance | Matched close-ups and source expectations | Material/rig/expression differences |
| Stage appearance | Wide and stage shots | Lighting, beam, shadow, and screen defects |
| Motion continuity | Recorded sequence and renderer ticks | Repeatable hitches or drift |
| UI clarity | Executed edit/import/output flow and captures | Interaction defects and proposed corrections |
| Performance | Instrumented run and OBS counter differences | Deterministic gate pass/fail |

The model must cite capture IDs and distinguish intended approximation from a regression. Track prompt/rubric version, model identifier, settings, fixture hash, and app commit. Do not allow the model to change acceptance thresholds for a failing run.

## Verification requirements

Unit tests cover command validation, revision conflicts, evidence labels, retry rules, and benchmark state transitions. Integration tests exercise the real stdio protocol and local app connection because serialization and disconnect behavior cross process boundaries. An OBS integration check uses a real test source because a mock cannot prove alpha or frame delivery.

Test reads, a bounded mutation, stale revision rejection, fresh capture, run/poll/cancel, reconnect, and resource cleanup. Pass the basic MCP round trip before expanding its tool surface.
