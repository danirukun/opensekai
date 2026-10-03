# OpenSekai macOS Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a moving, transparent macOS-to-OBS production path with one authoritative session and a useful MCP inspection, edit, capture, and evaluation loop.

**Architecture:** Tauri/Rust hosts a scoped loopback service and prepared files. A JavaScript worker owns the session; Three.js clients in the editor and OBS render evaluated state. UI and MCP use one command API, and native evaluation services own bounded runs and evidence.

**Tech Stack:** Tauri v2, Rust, Axum/Tokio, TypeScript, Svelte 5, @oshi-connect/ui, Three.js WebGPURenderer/TSL, three-vrm, bitECS candidate, MCP TypeScript SDK v2, Vitest, OBS WebSocket.

**Spec:** [macOS slice contract](../../../spdd/prompt/2026-10-02-opensekai-macos-feasibility.md), [slice analysis](../../../spdd/analysis/2026-10-02-opensekai-macos-feasibility.md), and [architecture](../specs/2026-10-02-opensekai-architecture-design.md).

## Global Constraints

- Start with macOS. Follow with Windows without replacing the shared core.
- Use Three.js WebGPURenderer with TSL.
- First material profiles are glTF PBR and VRM MToon.
- Add MCP in the first feasibility slice. Use the same validated command API as the editor.
- Use one authoritative simulation. Renderers consume evaluated state. Verify continued motion when the editor is minimized.
- Do not add a continuous image readback, JPEG encode, or image stream through Tauri IPC to the production output path.
- Use pnpm for JavaScript and TypeScript. Prefer functional TypeScript and plain data.
- Use Svelte 5 and @oshi-connect/ui for editor controls when the kit provides them.
- The session's explicit test rule requires unit tests for new function behavior.
- Use integration tests at real process, network, file, or protocol boundaries and state the reason.
- Full Unity shader compatibility and NDI are deferred.
- Update the parity checklist in each feature checkpoint. Claim only the behavior that was verified.

The slice limits are exact: schema version 1; 256 KiB maximum JSON frame; two queued state frames per client; 32 pending calls per client; 2-second RPC timeout; 2 MiB maximum diagnostic PNG; one capture per second per client; eight retained in-memory capture records; one active benchmark; 30-second warmup and 120-second measurement.

The 1080p60 concert target remains a later acceptance gate. This slice uses a small deterministic scene. It does not claim an M1 minimum, tracking support, avatar physics, or full parity.

## Review Focus

1. Editor minimized or occluded: current moving output must continue in OBS; test in Task 11.
2. Same port with a stale descriptor or wrong role: fail authentication without exposing native operations; test in Tasks 2 and 3.
3. Edit races and invalid numeric input: reject atomically without changing revision or persistent state; test in Tasks 2, 4, and 7.
4. Missing, corrupt, or unsupported avatar assets: show an explicit diagnostic, preserve the session, and release resources; test in Tasks 3 and 5.
5. Reload, slow client, cancelled run, and unrelated capture: recover current state or return a labeled failure; test in Tasks 3, 8, 9, and 11.

## Execution scope and agents

The architecture was approved for planning on 2026-10-02. The user has selected concurrent agents at lower effort. Preserve that execution method after plan review.

Do not spawn implementation agents while writing this plan. During execution, use the inherited model with reasoning_effort low and fork_turns none for bounded workers. Supply the task packet explicitly rather than copying the full conversation. Give reviewers enough reasoning for contracts and failures. Avoid a model override unless the user selects one.

With four available agent slots, the root integrates and three workers run concurrently:

~~~mermaid
flowchart TD
  T1["1: tooling and shell"] --> T2["2: shared contracts"]
  T2 --> T3["3: native service"]
  T2 --> T4["4: session worker"]
  T2 --> T5["5: renderer"]
  T3 --> T6["6: production integration"]
  T4 --> T6
  T5 --> T6
  T6 --> T7["7: editor controls"]
  T6 --> T8["8: MCP"]
  T6 --> T9["9: evaluation"]
  T7 --> T10["10: evidence integration"]
  T8 --> T10
  T9 --> T10
  T10 --> T11["11: macOS acceptance and handoff"]
~~~

Before each wave, publish a tested integrator checkpoint. Create one worktree per lane from that checkpoint. Workers own their listed source/test files. The integrator owns root manifests, dependency changes, lockfiles, bootstrap wiring, parity, and documentation. Workers return proposed parity changes in their handoff; the integrator applies them sequentially.

Each worker receives its own task section plus Global Constraints, Frozen interfaces, and the slice contract. The integrator retains the complete plan.

Task 1 creates only the package/configuration shells needed to run and test these lanes. It does not count empty packages as implemented features.

## File map

| Paths | Responsibility / owner |
| --- | --- |
| package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, vitest.config.ts | Workspace and TS checks; integrator |
| Cargo.toml, Cargo.lock, rust-toolchain.toml | Rust workspace and exact pins; integrator |
| .node-version, .npmrc, .gitignore | Toolchain and ignored local material; integrator |
| scripts/bootstrap-ui.ts, scripts/prepare-output.ts | Shared UI snapshot and output resource build; integrator |
| apps/desktop/index.html, vite.config.ts, src/main.ts, src/App.svelte | Editor boot and app shell; integrator |
| apps/desktop/src/app.css, src/editor/*, src/components/* | Editor interaction and layout; editor lane |
| apps/desktop/src/bootstrap.ts | Native descriptor and worker/preview lifecycle; integrator |
| apps/desktop/src-tauri/tauri.conf.json, build.rs, capabilities/main.json | Native app packaging and access; integrator |
| apps/desktop/src-tauri/src/lib.rs, src/main.rs | Tauri startup and service wiring; integrator |
| apps/desktop/src-tauri/src/service/*, src/assets/* | Loopback transport, scopes, asset registry; native lane |
| apps/desktop/src-tauri/tests/service_integration.rs | Real local network boundary; native lane |
| packages/contracts/src/*, test/*, fixtures/protocol/* | TS wire/schema types and shared test vectors; integrator |
| crates/contracts/src/lib.rs, tests/vectors.rs | Rust wire/schema types; integrator |
| packages/session/src/*, test/* | Authoritative state and worker; session lane |
| packages/browser-client/src/*, test/* | Typed WebSocket client and reconnect; integrator in Task 2 |
| packages/renderer/src/*, test/* | GPU setup, assets, frame application, capture; renderer lane |
| apps/output/index.html, src/main.ts, vite.config.ts | Standalone OBS renderer entry; renderer lane |
| apps/mcp/src/*, test/* | MCP tools, resources, and stdio lifecycle; MCP lane |
| crates/evaluation/src/*, tests/* | Run lifecycle, evidence metadata, fixed budgets; evaluation lane |
| tools/evaluation/src/*, test/* | OBS adapter, acceptance driver, rubric; evaluation lane |
| fixtures/smoke/manifest.json, source-policy.md | Public fixture metadata; renderer lane, reviewed by integrator |
| fixtures/local/*, .local/ui/*, artifacts/* | Ignored local assets, UI snapshot, and large evidence |
| docs/evaluation/macOS-feasibility/* | Committed summaries and checks; integrator |

Create a package.json for each JavaScript workspace path above. Package names are @opensekai/desktop, output, mcp, contracts, session, browser-client, renderer, and evaluation. Rust package names are opensekai-desktop, opensekai-contracts, and opensekai-evaluation.

## Pins and dependency policy

Verified metadata on 2026-10-02:

| Dependency | Exact initial pin |
| --- | --- |
| Node / pnpm / Rust | 26.10.0 / 12.8.1 / 1.93.1 |
| @tauri-apps/api and cli / tauri / tauri-build | 2.12.1 / 2.12.1 / 2.7.1 |
| axum / tokio | 0.8.9 / 1.53.1 |
| three / @types/three | 0.180.0 / 0.180.0 |
| @pixiv/three-vrm | 3.5.5 |
| bitecs | 0.4.0 |
| svelte / @sveltejs/vite-plugin-svelte | 5.57.1 / 7.3.1 |
| vite / vitest / typescript | 8.3.2 / 5.0.3 / 6.0.3 |
| svelte-check / @types/node / @types/ws | 4.7.6 / 26.6.4 / 8.18.2 |
| @modelcontextprotocol/server, client, core | 2.3.0 each |
| zod / tsx / ws / obs-websocket-js | 4.6.5 / 4.23.15 / 8.22.0 / 5.0.8 |
| @lucide/svelte | 1.50.0 |
| @oshi-connect/ui | Local dist snapshot from commit 25d5144d2ffaeed84d596c482a0e5424c1d9ea9e |

Three.js r180 matches the [three-vrm upstream development baseline](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/package.json). It is a compatibility candidate, not the latest Three.js release. Upgrade the pair only after material compile checks. The current [MCP v2 SDK](https://ts.sdk.modelcontextprotocol.io/v2/) uses split packages and the 2026-07-28 protocol.

For Tailwind, serde, serde_json, UUID/randomness helpers, and Rust test clients, the integrator resolves a published compatible version once in Task 1, records the exact value in docs/dependencies.md, and commits the lockfiles before agents fork. Workers must not resolve independent versions. Use pnpm's package build approval only for named dependencies that need it; no blanket lifecycle-script allowance.

The shared UI kit has no license field or license file in the observed checkout. Use a local snapshot for development. Public distribution requires the team's licensing decision and a reproducible public source/package route. This plan does not copy private registry tokens or commit the snapshot.

## Frozen interfaces

Task 2 creates these exports in @opensekai/contracts and matching Rust types. Names are part of the agent contract.

~~~ts
export type Id = string;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
export type Backend = "webgpu" | "webgl2";
export type Capability = "read" | "edit" | "capture" | "benchmark";
export type ErrorCode =
  | "INVALID_INPUT" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE"
  | "NOT_FOUND" | "UNSUPPORTED" | "TIMEOUT" | "RATE_LIMITED"
  | "BUSY" | "CANCELLED" | "VERSION_MISMATCH" | "STALE_FRAME";
export interface AppError { code: ErrorCode; message: string; ids: Id[] }
export type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export interface Transform {
  position: Vec3; rotation: Quat; scale: Vec3;
}
export interface EntityBase {
  id: Id; name: string; visible: boolean; transform: Transform;
}
export type SceneEntity =
  | (EntityBase & { kind: "mesh"; source: { kind: "box" } | { kind: "asset"; assetId: Id } })
  | (EntityBase & { kind: "avatar"; assetId: Id })
  | (EntityBase & { kind: "camera"; lens: { fovDegrees: number; near: number; far: number } });
export interface OutputSpec {
  id: Id; cameraId: Id; width: 1920; height: 1080; fps: 60;
}
export interface SceneView {
  schemaVersion: 1; sceneId: Id; revision: number;
  entities: SceneEntity[]; outputs: OutputSpec[];
}
export type PatchOp =
  | { kind: "setTransform"; entityId: Id; transform: Transform }
  | { kind: "setVisibility"; entityId: Id; visible: boolean };
export interface ScenePatch {
  sceneId: Id; expectedRevision: number; operations: PatchOp[];
}
export interface AssetRecord {
  id: Id; format: "glb" | "vrm"; sha256: string; bytes: number;
  sourceUrl: string | null; licenseLabel: string; importerVersion: 1;
}
export interface ConnectionDescriptor {
  schemaVersion: 1; sessionId: Id; httpOrigin: string; wsUrl: string;
  role: "publisher" | "operator" | "renderer";
  token: string; capabilities: Capability[]; outputId: Id | null;
}
export interface RuntimeFrame {
  schemaVersion: 1; sessionId: Id; sequence: number;
  tick: number; elapsedMs: number; scene: SceneView;
}
export interface FrameApplied {
  outputId: Id; sessionId: Id; sequence: number; tick: number;
  revision: number; cameraId: Id; backend: Backend;
  cpuMs: number; gpuMs: number | null; warnings: AppError[];
}
export interface AppStatus {
  schemaVersion: 1; sessionId: Id; ready: boolean; revision: number | null;
  capabilities: Capability[]; warnings: AppError[];
  outputs: { outputId: Id; connected: boolean; lastFrame: FrameApplied | null }[];
}
export interface CaptureParams {
  outputId: Id; expectedRevision: number;
  preset: "diagnostic_v1"; maxAgeMs: 500;
}
export interface CaptureRecord {
  id: Id; outputId: Id; revision: number; tick: number; sequence: number;
  backend: Backend; cameraId: Id; width: number; height: number;
  mimeType: "image/png"; bytes: number; sha256: string;
  resourceUri: string; createdAtUtc: string;
}
export interface BenchmarkParams {
  requestId: Id; fixtureId: "smoke_v1";
  profileId: "webgpu_smoke_v1" | "webgl2_smoke_v1";
}
export interface BenchmarkRun {
  id: Id; state: "warming" | "measuring" | "complete" | "cancelled" | "failed";
  progress: number; summaryResourceUri: string | null;
  error: ErrorCode | null;
}
export interface EvidenceManifest {
  id: Id; kind: "capture" | "benchmark";
  sessionId: Id; fixtureId: "smoke_v1"; appCommit: string;
  resources: { uri: string; mimeType: string; sha256: string; bytes: number }[];
}
export interface AppApi {
  appStatus(params: Record<string, never>): Promise<Reply<AppStatus>>;
  sceneInspect(params: { sceneId: Id }): Promise<Reply<SceneView>>;
  scenePatch(params: ScenePatch): Promise<Reply<{ revision: number }>>;
  cameraSelect(params: { outputId: Id; cameraId: Id; expectedRevision: number }): Promise<Reply<{ revision: number }>>;
  captureFrame(params: CaptureParams): Promise<Reply<CaptureRecord>>;
  benchmarkStart(params: BenchmarkParams): Promise<Reply<BenchmarkRun>>;
  benchmarkStatus(params: { runId: Id }): Promise<Reply<BenchmarkRun>>;
  benchmarkCancel(params: { runId: Id }): Promise<Reply<BenchmarkRun>>;
  evidenceRead(params: { evidenceId: Id }): Promise<Reply<EvidenceManifest>>;
}
export interface CaptureBytes {
  frame: FrameApplied; png: Uint8Array; width: number; height: number;
}
export interface DiagnosticMarker {
  sessionTag: number; sequence: number; tick: number;
  revision: number; cameraTag: number;
}
export interface Call {
  kind: "call"; requestId: Id; method: keyof AppApi; params: unknown;
}
export type ValidatedCall = {
  [Method in keyof AppApi]: {
    method: Method; params: Parameters<AppApi[Method]>[0];
  }
}[keyof AppApi];
export interface PublisherClient {
  onCall(listener: (call: ValidatedCall & { requestId: Id }) =>
    Promise<Reply<unknown>>): () => void;
  publishFrame(frame: RuntimeFrame): void;
  close(): void;
}
export interface BrowserClient extends ResourceHost {
  api: AppApi;
  onFrame(listener: (frame: RuntimeFrame) => void): () => void;
  sendApplied(frame: FrameApplied): void;
  onCapture(listener: (params: CaptureParams) => Promise<Reply<CaptureBytes>>): () => void;
  readResource(uri: string): Promise<Uint8Array>;
  close(): void;
}
export interface ResourceHost {
  readAsset(assetId: Id): Promise<ArrayBuffer>;
}
~~~

Frame.scene contains evaluated transforms. sceneInspect returns persistent transforms. Scripted motion must not change edit revision. An output camera edit changes revision. All clients apply the same tick; display interpolation must not generate simulation state.

Coordinate system: right-handed, Y up, meters, quaternion x/y/z/w. Camera fixtures store their orientation explicitly. Finite numbers only; positive scale; quaternion norm within 0.001 of one; near > 0; far > near; fovDegrees between 1 and 179; patch has 1–32 operations; scene has at most 64 entities in this slice. This is a smoke limit, not a product scene limit.

JSON wire envelopes: auth(role, token, schemaVersion, outputId), authReply(sessionId, schemaVersion, capabilities), call(requestId, method, params), reply(requestId, result), frame(RuntimeFrame), applied(FrameApplied), captureRequest(requestId, CaptureParams), captureReply(requestId, metadata, pngBase64), and ping/pong(requestId). Authenticate before any other message. Capture replies use a separate 3 MiB encoded-envelope limit so a 2 MiB PNG can cross the diagnostic path; ordinary JSON frames retain the 256 KiB limit.

Diagnostic marker v1 encodes five unsigned 32-bit words in this order: sessionTag, sequence, tick, revision, cameraTag. Each word is most-significant bit first. Draw eight alternating 1/0 header cells, then the 160 data cells in one row at the top-left. Each cell is 2 × 8 physical output pixels. The complete marker is 336 × 8 pixels and uses exact black/white opaque output values. sessionTag/cameraTag use a shared FNV-1a hash of the UTF-8 ID. Task 2 exports tagId(id: Id): number and encodeMarker(marker: DiagnosticMarker): Uint8Array. Task 5 draws the cells as an orthographic overlay in the actual GPU canvas only in diagnostics mode. Task 9 decodes that same region from PNG bytes. Never substitute an annotation added only after capture.

The native service routes sceneInspect, scenePatch, and cameraSelect to the sole publisher. It handles status, captures, runs, and evidence itself. The publisher cannot serve arbitrary files. Renderers can receive state, acknowledge frames, and answer bounded capture requests. Operator grants are read-only by default; local evaluation mode grants edit/capture/benchmark.

Descriptor discovery: the app writes an operator descriptor atomically to its app-data directory with owner-only permissions. The MCP CLI receives its exact path through OPENSEKAI_CONNECTION_FILE. It verifies schema/session and connects. Credentials never appear in HTTP request URLs, query strings, or logs. The OBS renderer ticket travels in the URL fragment, is removed from browser history after bootstrap, and grants only renderer permissions. Prepared asset fetch uses Authorization rather than a URL token.

## Common verification commands

These scripts are implemented in Task 1 and completed as their source exists:

~~~sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:unit
cargo test --workspace
pnpm build
pnpm dev:desktop
pnpm mcp
pnpm evaluate:smoke
~~~

pnpm check runs workspace TypeScript checks and svelte-check. test:unit runs the unit Vitest project, including editor logic tests. scripts/*.test.ts are file-boundary tests in the integration project. Use a root-relative Vitest configuration with test.root set to the repository, and integration project globs that exclude pure tests. Integration tests run only through named package scripts or the commands in their task. pnpm build builds the output resources and desktop frontend; pnpm build:mac additionally creates the unsigned local release app with Tauri. No notarization or distribution is part of this slice.

## Task 1: Pinned workspace and runnable macOS shell

**Owner:** integrator. **Depends on:** approved plan.

**Files:** Create root manifests/toolchain files; package manifests for the file map; Cargo workspace/manifests; apps/desktop shell and Tauri files; scripts/bootstrap-ui.ts; scripts/prepare-output.ts; scripts/bootstrap-ui.test.ts; scripts/prepare-output.test.ts; docs/dependencies.md. Modify .gitignore to exclude .local/ and generated apps/desktop/src-tauri/resources/output/.

**Interfaces:** Produce the command scripts above, desktop window label main, and a native app_version() command returning package version. Build output is copied into resources/output/ before Tauri packaging.

- [x] **Step 1: Verify the installed tools and pin dependencies.**

~~~sh
node --version
pnpm --version
rustc --version
xcode-select -p
~~~

Use the exact pins above. Resolve remaining helper versions, including Tailwind, PNG decoders for Rust/TypeScript, Rust random/UUID/HTTP test helpers, serde, and serde_json, through published metadata and record them. Fail on incompatible engine constraints instead of ignoring peer errors.

- [x] **Step 2: Create the workspace configuration and shells.**

~~~json
{
  "name": "opensekai",
  "private": true,
  "packageManager": "pnpm@12.8.1",
  "type": "module",
  "scripts": {
    "check": "pnpm -r --if-present check",
    "test:unit": "vitest run --project unit",
    "build": "pnpm --filter @opensekai/output build && tsx scripts/prepare-output.ts && pnpm --filter @opensekai/desktop build",
    "dev:desktop": "pnpm build && pnpm --filter @opensekai/desktop tauri dev",
    "build:mac": "pnpm build && pnpm --filter @opensekai/desktop tauri build --bundles app",
    "mcp": "tsx apps/mcp/src/cli.ts",
    "evaluate:smoke": "tsx tools/evaluation/src/run-smoke.ts"
  }
}
~~~

Use a pnpm workspace for apps/*, packages/*, and tools/*. Keep package exports pointed at src/index.ts for Vite/tsx development. Use ES2022, strict TS, and moduleResolution bundler. Mark code as erasable TypeScript where the pinned compiler supports it. Vitest's unit project includes pure tests under package/test and app/test paths; use separate integration projects.

Build the root Cargo workspace with the three named members. Initialize the two library crates with only crate attributes until their implementation tasks. Pin direct Rust dependencies in workspace.dependencies and commit Cargo.lock.

Tauri's initial native boundary is:

~~~rust
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
~~~

Use Vite for the Svelte SPA. Set Tauri beforeDevCommand to run Vite for @opensekai/desktop, beforeBuildCommand to build that frontend, devUrl to its loopback port, and frontendDist to ../dist. Keep global Tauri injection disabled. Window main receives only the native/window permissions needed by this plan. No remote page receives a native bridge.

- [x] **Step 3: Add the reproducible local UI adapter and output preparation.**

~~~ts
export async function snapshotUi(sourceDir: string, targetDir: string):
  Promise<{ sha256: string; sourceCommit: string | null }>;
export async function prepareOutput(sourceDir: string, targetDir: string):
  Promise<void>;
~~~

snapshotUi copies only package.json and dist into .local/ui, removes lifecycle scripts from the generated package.json, and records hashes. Read source from OPENSEKAI_UI_SOURCE; on this host it is /Users/danirukun/ghq/github.com/oshi-connect/oshi-connect-ui. Do not edit or build the sibling checkout. Use file:../../.local/ui from apps/desktop. Each worktree runs the adapter before install. Keep this dependency declaration and lockfile consistent across worktrees.

prepareOutput copies built output files into the native resources/output directory. Resolve these files from Tauri's resource directory in the release app. Never depend on current working directory. The initial output entry can be a plain static HTML page until Task 5.

Write the adapter tests before its implementation. They use a temporary fake source with dist/index.js, package.json containing prepare, and a root .env file. Assert only dist/package metadata reaches the snapshot, prepare is absent, and hashes are stable. Output preparation tests copy a fixture into a temporary destination and reject a missing source. These are file-boundary tests because release loading depends on exact copied paths.

The essential snapshot implementation is:

~~~ts
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

export async function snapshotUi(sourceDir: string, targetDir: string) {
  const pkg = JSON.parse(await readFile(join(sourceDir, "package.json"), "utf8"));
  delete pkg.scripts;
  await mkdir(targetDir, { recursive: true });
  await cp(join(sourceDir, "dist"), join(targetDir, "dist"), { recursive: true });
  await writeFile(join(targetDir, "package.json"), JSON.stringify(pkg, null, 2));
  const dist = join(targetDir, "dist");
  const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash("sha256").update(JSON.stringify(pkg));
  for (const file of files) {
    hash.update(relative(dist, file).replaceAll("\\", "/"));
    hash.update(await readFile(file));
  }
  return { sha256: hash.digest("hex"), sourceCommit: null as string | null };
}
~~~

The CLI resolves targetDir to this checkout's .local/ui and rejects any other destination. Clear that generated directory before each snapshot so removed files cannot persist. Record the expected source revision from the dependency table separately; a dist hash does not prove a clean source checkout. prepareOutput uses the same fixed-destination copy pattern, verifies source/index.html exists, and clears generated output before copying. Its CLI resolves paths from import.meta.url, not process.cwd().

Run the adapter once before installing the file dependency:

~~~sh
OPENSEKAI_UI_SOURCE=/Users/danirukun/ghq/github.com/oshi-connect/oshi-connect-ui node scripts/bootstrap-ui.ts
~~~

For the initial bootstrap before workspace dependencies exist, use the installed Node 26 native TypeScript support to run the erasable script: node scripts/bootstrap-ui.ts. Subsequent calls can use tsx after install. Run pnpm exec vitest run scripts/bootstrap-ui.test.ts scripts/prepare-output.test.ts --project integration after install. Add the Tailwind Vite plugin and scan .local/ui/dist so shared component utilities are generated.

- [x] **Step 4: Run the shell and verify the native version round trip.**

~~~sh
pnpm install
pnpm check
pnpm --filter @opensekai/desktop tauri dev
~~~

Expected: one OpenSekai window; app_version resolves to 0.1.0; shared Button/Input render; no console errors. Exercise minimize/restore once. This is a smoke check, not a static-label unit test.

- [x] **Step 5: Checkpoint.**

~~~sh
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.config.ts Cargo.toml Cargo.lock rust-toolchain.toml .node-version .npmrc .gitignore scripts apps packages crates tools docs/dependencies.md
git diff --cached --check
git commit -m "chore: establish macOS workspace and desktop shell"
~~~

## Task 2: Shared schemas and a reconnecting typed client

**Owner:** integrator. **Depends on:** Task 1.

**Files:** Create packages/contracts/src/{types,schema,fixtures,marker,index}.ts; packages/contracts/test/schema.test.ts; fixtures/protocol/{valid-scene,invalid-patch,valid-frame,valid-applied,invalid-role}.json; crates/contracts/src/lib.rs and tests/vectors.rs; packages/browser-client/src/{client,reconnect,index}.ts; packages/browser-client/test/client.test.ts.

**Interfaces:** Consume the pinned schema tools. Produce the frozen types, makeSmokeScene(): SceneView, makeSmokeFrame(overrides: Partial<Pick<RuntimeFrame, "sequence" | "tick">>): RuntimeFrame, validateCall(method: unknown, params: unknown): Reply<ValidatedCall>, requiredCapability(method: keyof AppApi): Capability, tagId(id: Id): number, encodeMarker(marker: DiagnosticMarker): Uint8Array, connectClient(descriptor: ConnectionDescriptor): Promise<BrowserClient>, and connectPublisher(descriptor: ConnectionDescriptor): Promise<PublisherClient>. Rust exports matching wire types, RunState::{Warming, Measuring, Complete, Cancelled, Failed}, and parse_call(bytes: &[u8]) -> Result<Call, AppError>. Call.method remains a validated String; Call.params is validated serde_json::Value.

- [x] **Step 1: Write schema, role, and stream tests before implementation.**

~~~ts
import { expect, it } from "vitest";
import { makeSmokeScene, validateCall, requiredCapability } from "../src/index";

it("rejects a non-finite transform before an edit can be sent", () => {
  const scene = makeSmokeScene();
  const transform = structuredClone(scene.entities[0].transform);
  transform.position[0] = NaN;
  const result = validateCall("scenePatch", {
    sceneId: scene.sceneId, expectedRevision: 0,
    operations: [{ kind: "setTransform", entityId: "marker", transform }]
  });
  expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
});
it("keeps scene edits outside renderer capability", () => {
  expect(requiredCapability("scenePatch")).toBe("edit");
});
~~~

Add vectors for unknown fields, schema version 2, zero/non-unit quaternion, invalid lens, 33 operations, wrong method/params pairing, and oversized messages. Shared valid-scene uses scene_smoke, marker, performer, camera_wide, camera_close, and output_main. Initial revision is zero. Add output_main and preview_main, both with the nominal 1080p60 spec. Store the valid acknowledgement in valid-applied.json. Marker tests pin bit order, UTF-8 tags, all-zero/all-one words, and rollover.

Client tests use a fake transport/clock: wrong session reply is rejected, disconnect rejects pending calls, a fresh snapshot replaces stale state, and out-of-order sequences are ignored. At most one reconnect timer is active.

- [x] **Step 2: Run the failing tests.**

~~~sh
pnpm exec vitest run packages/contracts/test/schema.test.ts --project unit
pnpm exec vitest run packages/browser-client/test/client.test.ts --project unit
cargo test -p opensekai-contracts
~~~

Expected initial failure: missing exports/validation behavior. Tool installation failure is not a valid red test.

- [x] **Step 3: Implement strict schemas and the bounded client.**

~~~ts
const editMethods = new Set(["scenePatch", "cameraSelect"]);
export function requiredCapability(method: keyof AppApi): Capability {
  if (editMethods.has(method)) return "edit";
  if (method === "captureFrame") return "capture";
  if (method.startsWith("benchmark")) return "benchmark";
  return "read";
}
~~~

Import Capability/AppApi from types.ts. Build Zod schemas for every frozen type. Validate semantic references and numeric constraints in addition to structural JSON. Generate public JSON schemas and hand-maintain Rust mirrors; shared vectors must pass identically.

The client waits for a matching authReply first, buffers the latest full frame until a listener attaches, validates every reply/frame, pairs request IDs, rejects requests over the limits, and uses a 2-second timeout. Reconnect delays are 100, 250, 500, and 1000 ms, capped at 1000 ms. Never retry a mutation automatically. After reconnect, wait for an authoritative full frame before marking the output current. close() clears timers/listeners and rejects pending requests.

- [x] **Step 4: Run focused checks and type checks.**

~~~sh
pnpm exec vitest run packages/contracts/test/schema.test.ts --project unit
pnpm exec vitest run packages/browser-client/test/client.test.ts --project unit
cargo test -p opensekai-contracts
pnpm check
~~~

Expected: identical vectors accepted/rejected in TS and Rust; bounded cleanup tests pass. Export makeSmokeScene and its JSON from one source so agents share a fixture.

- [x] **Step 5: Freeze and checkpoint the interfaces.**

~~~sh
git add packages/contracts packages/browser-client crates/contracts fixtures/protocol Cargo.lock docs/dependencies.md
git diff --cached --check
git commit -m "feat: freeze versioned session and client contracts"
~~~

Use this commit as the first parallel-wave base. Workers must ask the integrator to change frozen interfaces.

## Task 3: Scoped native loopback service and asset registry

**Owner:** native worker. **Depends on:** Task 2. **Can run with:** Tasks 4 and 5.

**Files:** Create apps/desktop/src-tauri/src/service/{mod,auth,router,queues}.rs; src/assets/{mod,registry}.rs; tests/service_integration.rs. Add unit tests inside auth/queues/registry modules. The integrator wires lib.rs in Task 6.

**Interfaces:** Consume opensekai-contracts wire types. Produce:

~~~rust
pub struct ServiceConfig {
    pub output_root: std::path::PathBuf,
    pub asset_manifest: std::path::PathBuf,
    pub evidence_root: std::path::PathBuf,
    pub evaluation_enabled: bool,
}
pub async fn start_service(config: ServiceConfig)
    -> Result<ServiceHandle, AppError>;
impl ServiceHandle {
    pub fn publisher_descriptor(&self) -> ConnectionDescriptor;
    pub fn operator_descriptor(&self) -> ConnectionDescriptor;
    pub fn renderer_descriptor(&self, output_id: &str)
        -> Result<ConnectionDescriptor, AppError>;
    pub async fn shutdown(self) -> Result<(), AppError>;
}
pub fn allowed_origin(origin: &str, service_origin: &str) -> bool;
pub fn resolve_asset(id: &str, registry: &AssetRegistry)
    -> Result<std::path::PathBuf, AppError>;
~~~

AppError is the shared error object from Reply. ServiceHandle internally owns task cancellation, pending requests, tokens, and current publisher/output connections. Add a descriptor-writing helper that atomically replaces owner-readable operator and output renderer descriptor files; return their paths only to trusted app bootstrap. Add ServiceHandle::last_applied(output_id: &str) -> Option<(FrameApplied, u64)>, applied_at(output_id: &str, sequence: u64) -> Option<(FrameApplied, u64)>, and request_capture(params: CaptureParams) -> Result<CaptureBytes, AppError> for the native evaluation bridge. The timestamp is the native monotonic receive time. Export ServiceHandle::now_ms(&self) -> u64 from the same clock origin, and use it for evaluation age checks. Keep a bounded ring of the last 32 validated acknowledgements per output for capture correlation. Clear it on reconnect/session change. The request_capture helper forwards to the authenticated renderer and pairs its reply; public capture RPC stays UNSUPPORTED until Task 10 enforces the budgets.

The router owns route_scene_call(call: Call) -> Reply<serde_json::Value> as an async method. Define RpcContext with client_id: String, assigned by the authenticated connection, and never read from call params. Define RpcHandler as an Arc callback from (Call, RpcContext) to a boxed Send future returning Reply<serde_json::Value>. ServiceHandle::install_evaluation_handler(handler: RpcHandler) installs the optional native evaluation handler. The router checks capabilities before invoking it. Clear the handler and pending requests during shutdown. Avoid strong service/handler reference cycles.

- [x] **Step 1: Write focused logic tests and real network tests.**

~~~rust
#[test]
fn renderer_origin_must_match_the_service() {
    assert!(allowed_origin("http://127.0.0.1:41000", "http://127.0.0.1:41000"));
    assert!(!allowed_origin("https://example.test", "http://127.0.0.1:41000"));
}
~~~

The tests also cover an encoded traversal asset ID, unknown asset, symlink escaping the registered root, stale token/session, renderer edit attempt, second publisher, wrong output ticket, and limits. Accept only the exact service HTTP origin and explicitly required local Tauri origins. Missing Origin is allowed only for authenticated native clients; literal null is denied in this initial path.

The real integration test starts the service on port zero, uses a temp asset manifest, and connects a publisher and renderer through real WebSockets. Publish a valid frame, request sceneInspect, return its reply, disconnect/reconnect the renderer, and check the latest full frame. This boundary test is required because queueing, auth, and disconnects cannot be proved with a mock alone.

- [x] **Step 2: Run failing tests.**

~~~sh
cargo test -p opensekai-desktop service
cargo test -p opensekai-desktop --test service_integration
~~~

Expected: required service/auth/queue behaviors fail before implementation.

- [x] **Step 3: Implement loopback binding, scoped routing, and bounded queues.**

~~~rust
let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
let address = listener.local_addr()?;
~~~

Use a single authenticated publisher. Reject an unauthenticated connection after 2 seconds. Validate Host against the bound loopback address and permit only the documented origins. Tokens are random per session and scoped per role/output. Do not log them.

Route scene calls to the publisher; pair replies by request ID. Disconnect rejects pending calls with UNAVAILABLE. Slow renderers receive the newest full state; superseded full frames can be discarded. Never discard a command or reply to make room for pose data.

Serve /renderer/ and its compiled files from output_root. Serve registered self-contained GLB/VRM bytes by opaque asset ID with Authorization and exact-origin CORS. Reject traversal, unexpected symlink targets, unregistered paths, external glTF resource URIs, and wrong hashes. No arbitrary file route exists.

Read the initial manifest from OPENSEKAI_FIXTURE_MANIFEST, an explicit local app configuration. Asset registration is configuration, not a generic MCP file-read capability. Missing/corrupt assets return NOT_FOUND/INVALID_INPUT and preserve the service.

Status reports ready only after a publisher and current output acknowledgement exist. Evaluation calls return UNSUPPORTED until Task 10 installs the real evaluation handler. Do not return fabricated captures or successful runs.

- [x] **Step 4: Run boundary checks and cleanup tests.**

~~~sh
cargo test -p opensekai-desktop service
cargo test -p opensekai-desktop --test service_integration
cargo clippy -p opensekai-desktop --all-targets -- -D warnings
~~~

Expected: successful reconnect, denied role violations, bounded queues, and no task leak after shutdown. Verify the operator descriptor is owner-only on macOS.

- [x] **Step 5: Commit owned files and hand off.**

~~~sh
git add apps/desktop/src-tauri/src/service apps/desktop/src-tauri/src/assets apps/desktop/src-tauri/tests/service_integration.rs
git diff --cached --check
git commit -m "feat: add scoped local scene transport and assets"
~~~

Return the commit, commands run, limits tested, and proposed parity scope. Do not stage root files or lockfile changes.

## Task 4: Authoritative worker session behind an ECS adapter

**Owner:** session worker. **Depends on:** Task 2. **Can run with:** Tasks 3 and 5.

**Files:** Create packages/session/src/{session,ecs,smoke-motion,worker,index}.ts; packages/session/test/{session,motion,worker-lifecycle}.test.ts.

**Interfaces:** Consume makeSmokeScene, frozen scene/frame types, and connectPublisher. Produce:

~~~ts
export interface Session {
  inspect(): SceneView;
  applyPatch(patch: ScenePatch): Reply<{ revision: number }>;
  selectCamera(params: { outputId: Id; cameraId: Id; expectedRevision: number }):
    Reply<{ revision: number }>;
  advance(elapsedMs: number): RuntimeFrame;
}
export function createSession(scene: SceneView, sessionId: Id): Session;
export function markerRotation(elapsedMs: number): Quat;
~~~

worker.ts accepts one initial message containing { descriptor, scene }. It owns connectPublisher and one 60 Hz timer. Stop messages close the connection and timer. No UI or Three.js imports belong here.

- [x] **Step 1: Write atomic edit and deterministic motion tests.**

~~~ts
import { expect, it } from "vitest";
import { makeSmokeScene } from "@opensekai/contracts";
import { createSession } from "../src/session";

it("keeps a failed multi-edit atomic", () => {
  const session = createSession(makeSmokeScene(), "session_test");
  const before = session.inspect();
  const result = session.applyPatch({
    sceneId: before.sceneId, expectedRevision: 0,
    operations: [
      { kind: "setVisibility", entityId: "marker", visible: false },
      { kind: "setVisibility", entityId: "missing", visible: false }
    ]
  });
  expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(session.inspect()).toEqual(before);
});
it("evaluates motion without rewriting persistent edits", () => {
  const session = createSession(makeSmokeScene(), "session_test");
  const before = session.inspect();
  const frame = session.advance(1000);
  expect(frame.tick).toBe(60);
  expect(frame.scene.revision).toBe(0);
  expect(frame.scene.entities[0].transform.rotation)
    .not.toEqual(before.entities[0].transform.rotation);
  expect(session.inspect()).toEqual(before);
});
~~~

Also test stale revision, duplicate IDs, a missing/non-camera target, NaN/zero scale, clone isolation, identical replay output, backward elapsed time rejection, and worker stop/start without duplicate timers.

- [x] **Step 2: Run the failing tests.**

~~~sh
pnpm exec vitest run packages/session/test/session.test.ts packages/session/test/motion.test.ts packages/session/test/worker-lifecycle.test.ts --project unit
~~~

Expected: missing behavior fails; contracts already pass.

- [x] **Step 3: Implement the session and a small bitECS adapter.**

~~~ts
export function markerRotation(elapsedMs: number): Quat {
  const halfAngle = (elapsedMs / 1000) * Math.PI / 4;
  return [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
}
~~~

Use a stable-ID-to-ECS-ID map and packed transform components. Store persistent edits separately from evaluated output. Apply a validated patch to a copy, validate every referenced entity, then commit once and increment revision once. Failed edits change nothing.

The smoke scene moves the marker and applies a small deterministic root motion to the performer. It does not evaluate avatar bones or springs. advance takes elapsed time from the worker's monotonic clock, computes tick = floor(elapsedMs * 60 / 1000), and increments stream sequence per published frame. Test repeatable values rather than timer accuracy in unit tests.

Do not use requestAnimationFrame for session timing. The worker owns its WebSocket and timer, so the hidden main document is not the transport owner. This still needs the macOS scheduling gate.

Use bitECS's pinned API behind ecs.ts. Keep its data structures internal. Compare adapter ergonomics and recorded CPU work at the later concert stage; do not benchmark a box and declare the ECS choice settled.

- [ ] **Step 4: Verify logic and the worker in a browser harness.**

~~~sh
pnpm exec vitest run packages/session/test/session.test.ts packages/session/test/motion.test.ts packages/session/test/worker-lifecycle.test.ts --project unit
pnpm --filter @opensekai/session check
~~~

Use the output harness from Task 5 when merged to inspect emitted ticks. A real hidden-window check belongs to Task 11, not a fake-clock test.

- [x] **Step 5: Checkpoint owned files.**

~~~sh
git add packages/session/src packages/session/test
git diff --cached --check
git commit -m "feat: add authoritative smoke session worker"
~~~

Hand off the entry protocol, public exports, tests, and any adapter issues.

## Task 5: Three.js renderer and prepared fixture path

**Owner:** renderer worker. **Depends on:** Task 2. **Can run with:** Tasks 3 and 4.

**Files:** Create packages/renderer/src/{renderer,backend,assets,apply-frame,capture,diagnostic-marker,index}.ts; test/{frame-state,asset-lifecycle,capture-policy}.test.ts; apps/output/index.html, src/main.ts, vite.config.ts; fixtures/smoke/manifest.json and source-policy.md.

**Interfaces:** Consume RuntimeFrame, FrameApplied, ResourceHost, CaptureBytes, and connectClient. Produce:

~~~ts
export interface RendererHandle {
  applyFrame(frame: RuntimeFrame): Promise<FrameApplied>;
  capture(): Promise<CaptureBytes>;
  dispose(): void;
}
export function createRenderer(options: {
  canvas: HTMLCanvasElement; outputId: Id;
  mode: "auto" | "force-webgl2"; resources: ResourceHost;
  diagnostics: boolean; resolutionScale: 1 | 0.5;
}): Promise<RendererHandle>;
export function selectFrame(previous: RuntimeFrame | null, incoming: RuntimeFrame):
  Reply<RuntimeFrame>;
~~~

- [x] **Step 1: Write frame/resource/capture policy tests.**

~~~ts
import { expect, it } from "vitest";
import { makeSmokeFrame } from "@opensekai/contracts";
import { selectFrame } from "../src/apply-frame";

it("rejects a stale sequence within a session", () => {
  const current = makeSmokeFrame({ sequence: 20, tick: 20 });
  const stale = makeSmokeFrame({ sequence: 19, tick: 19 });
  expect(selectFrame(current, stale))
    .toMatchObject({ ok: false, error: { code: "STALE_FRAME" } });
});
~~~

Add tests for a new session replacing old state, missing asset results, cancelled load disposal, duplicate resource release, oversize capture, and capture rate limiting. These test logic through injected loader/GPU ports. Actual GPU/material correctness requires the browser checks below.

- [x] **Step 2: Run the failing logic tests.**

~~~sh
pnpm exec vitest run packages/renderer/test/frame-state.test.ts packages/renderer/test/asset-lifecycle.test.ts packages/renderer/test/capture-policy.test.ts --project unit
~~~

Expected: policy/state/resource logic fails before implementation.

- [x] **Step 3: Implement renderer initialization and MToon loading.**

~~~ts
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MToonMaterialLoaderPlugin, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { MToonNodeMaterial } from "@pixiv/three-vrm/nodes";

const renderer = new WebGPURenderer({
  canvas, alpha: true, antialias: true, forceWebGL: mode === "force-webgl2"
});
await renderer.init();
renderer.setClearColor(0x000000, 0);
const loader = new GLTFLoader();
loader.register(parser => new VRMLoaderPlugin(parser, {
  mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, {
    materialType: MToonNodeMaterial
  })
}));
~~~

The options canvas/mode come from createRenderer. Use the pinned renderer's backend flags to report the actual backend; do not infer WebGPU success from navigator.gpu alone. Use transparent page/canvas CSS and Scene.background = null.

Load registered bytes through ResourceHost.readAsset and GLTFLoader.parseAsync. Reject external resource URIs in this slice. Build GPU nodes once and update transforms/visibility from evaluated frames. Resolve selected cameras through outputId. Dispose replaced scene resources, textures, buffers, and subscriptions. An asset failure produces a FrameApplied warning and leaves other entities/session output alive; a backend initialization failure rejects renderer creation. Preserve warnings for the inspector/MCP status. Static assets do not reparse on every frame.

For this slice, disable VRM spring simulation and avoid generic vrm.update(dt) in renderer clients. Do not advance avatar pose, physics, or a local motion generator. Material-only updates must not change pose. Report unsupported material/constraint behavior explicitly.

applyFrame returns an acknowledgement after render submission, including actual camera and backend. gpuMs is null unless a supported timer reports a valid value. capture performs one bounded PNG readback and labels the same displayed frame. Do not enable preserveDrawingBuffer or capture on each render. Draw the frozen diagnostic marker in the actual canvas when diagnostics is true; image capture and OBS must both see it. Draw nothing extra in normal output.

- [x] **Step 4: Register real fixture metadata and exercise both backends.**

The official [three-vrm sample directory](https://github.com/pixiv/three-vrm/tree/release/packages/three-vrm/examples/models) contains VRM1_Constraint_Twist_Sample.vrm. Use the [VRM sample repository](https://github.com/vrm-c/vrm-specification/tree/master/samples) to review its source terms. Download only for local testing; store bytes under fixtures/local/. Record the exact source revision, SHA-256, embedded VRM terms, and permitted use. Do not infer asset redistribution rights from the loader's MIT license.

Use fixture_vrm_1 for this source and fixture_glb_1 for a locally generated, self-contained GLB reference object. The manifest records absolute local paths only in its ignored local copy; the tracked manifest carries IDs, hashes, and source terms. If VRM0 data is available from the user's licensed assets, register fixture_vrm_0 and test it. Otherwise mark VRM0 acceptance pending; the first slice can pass VRM1 without claiming both.

Build the output page, load a controlled fixture in a browser, and inspect actual WebGPU and forced-WebGL2 results. Check silhouette, material, clear alpha, camera selection, and resource reload. Record initialization/material compile failures.

~~~sh
pnpm exec vitest run packages/renderer/test/frame-state.test.ts packages/renderer/test/asset-lifecycle.test.ts packages/renderer/test/capture-policy.test.ts --project unit
pnpm --filter @opensekai/output build
pnpm check
~~~

- [x] **Step 5: Checkpoint the renderer and fixture policy.**

~~~sh
git add packages/renderer/src packages/renderer/test apps/output fixtures/smoke
git diff --cached --check
git commit -m "feat: add transparent VRM output renderer"
~~~

Return the material/backend observations separately from unit-test results.

## Task 6: Integrate the first real production path

**Owner:** integrator. **Depends on:** Tasks 3, 4, and 5 merged individually.

**Files:** Modify apps/desktop/src-tauri/src/lib.rs, main.rs, tauri.conf.json, capabilities/main.json; create apps/desktop/src/bootstrap.ts; modify src/main.ts and App.svelte. Complete scripts/prepare-output.ts wiring. Record docs/evaluation/macOS-feasibility/first-output.md.

**Interfaces:** Native bootstrap_session returns:

~~~ts
export interface NativeBootstrap {
  publisher: ConnectionDescriptor;
  operator: ConnectionDescriptor;
  preview: ConnectionDescriptor;
  output: ConnectionDescriptor;
  operatorDescriptorFile: string; rendererDescriptorFile: string;
  assets: AssetRecord[];
}
export async function bootstrapDesktop(): Promise<{
  client: BrowserClient; outputUrl: string; stop(): Promise<void>;
}>;
~~~

The trusted desktop module owns NativeBootstrap; it is not an extension API. Output ticket is scoped to output_main; preview ticket is scoped to preview_main. The evaluation CLI uses OPENSEKAI_RENDERER_CONNECTION_FILE for the owner-only output descriptor. Main desktop Vite uses http://127.0.0.1:1420. Record actual packaged Tauri Origin; add only that exact local origin to the tested allowlist.

- [x] **Step 1: Merge each lane and run its focused checks.**

Use one worker commit at a time. Resolve dependency or contract changes through the integrator. Do not merge unverified implementation together and rely on a later smoke test.

~~~sh
pnpm test:unit
cargo test --workspace
pnpm check
~~~

- [x] **Step 2: Wire native startup and the worker.**

~~~ts
import { invoke } from "@tauri-apps/api/core";
import SessionWorker from "@opensekai/session/worker?worker";
import { makeSmokeScene } from "@opensekai/contracts";

const info = await invoke<NativeBootstrap>("bootstrap_session");
const worker = new SessionWorker();
worker.postMessage({ descriptor: info.publisher, scene: makeSmokeScene() });
~~~

Native startup resolves bundled output resources and the configured fixture manifest. Spawn service initialization from Tauri setup; bootstrap_session waits for readiness with a 5-second startup deadline. A failed startup returns a clear error. Register app_version and bootstrap_session only for the trusted main window. Use explicit app-command permissions through Tauri's app manifest/capabilities.

bootstrapDesktop starts one worker, one low-rate preview client, and one operator client. Preview resolutionScale is 0.5 and refresh cap is 15 FPS. OBS resolutionScale is 1 and its configured source rate is 60 FPS. Both consume output definitions; their output IDs are separate.

Build outputUrl from service origin + /renderer/ with the renderer descriptor encoded in the fragment. Only the user-facing copy action can expose that URL. Do not log it or include it in committed evidence. stop closes clients, terminates the worker, and invokes native service shutdown on app exit.

- [x] **Step 3: Set up an isolated OBS source and confirm moving alpha output.**

Use the existing local WebSocket endpoint. Read GetVersion/GetVideoSettings/GetStreamStatus before making a test scene. Save original scene selection. Create a uniquely named OpenSekai Feasibility scene and browser source owned by this run; do not replace an existing source.

Set the browser source to outputUrl, 1920 × 1080, custom 60 FPS, with transparent CSS. Keep it active for the run. Select the test scene only during evaluation. Restore the original scene when done.

Expected: marker motion comes from session ticks; a real registered VRM is visible; camera changes use the session API; background alpha reaches OBS. Keep recording/streaming idle during this basic check. If streaming or recording is active, return BUSY without switching scenes; inspection can continue.

- [x] **Step 4: Check the release resource path and run cleanup.**

~~~sh
pnpm build:mac
~~~

Launch the resulting unsigned local app from Finder or a process launcher with a working directory outside the checkout. Verify /renderer/ and registered assets still load. Run with the explicit local fixture configuration; do not imply that private fixtures were bundled.

Close/reopen the app. Verify no stale service port, duplicate publisher, or hung client survives. If the backend/material probe fails, record the exact failure before continuing.

- [x] **Step 5: Commit the integration and evidence summary.**

~~~sh
git add apps/desktop/src apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/main.rs apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities/main.json scripts/prepare-output.ts docs/evaluation/macOS-feasibility/first-output.md
git diff --cached --check
git commit -m "feat: connect the macOS session to OBS output"
~~~

This checkpoint is the second parallel-wave base. It proves a production path, not the complete slice gate.

## Task 7: Familiar editor controls over the common API

**Owner:** editor worker. **Depends on:** Task 6. **Can run with:** Tasks 8 and 9.

**Files:** Create apps/desktop/src/editor/{model,numeric}.ts; src/editor/model.test.ts and numeric.test.ts; src/components/{Hierarchy,Inspector,OutputControls,AssetList}.svelte; modify src/app.css. App.svelte composition remains with the integrator in Task 10.

**Interfaces:** Consume BrowserClient.api, AppStatus warnings, and the shared scene types. Produce:

~~~ts
export interface EditorView {
  scene: SceneView | null; selectedId: Id | null;
  error: ErrorCode | null; pending: boolean;
}
export function createEditorModel(api: AppApi): {
  read(): EditorView;
  subscribe(listener: (view: EditorView) => void): () => void;
  load(): Promise<void>;
  select(entityId: Id): void;
  setPosition(entityId: Id, position: Vec3): Promise<Reply<{ revision: number }>>;
  setVisibility(entityId: Id, visible: boolean): Promise<Reply<{ revision: number }>>;
  selectCamera(cameraId: Id): Promise<Reply<{ revision: number }>>;
};
export function parseFiniteNumber(text: string): Reply<number>;
~~~

Props are fixed: Hierarchy and Inspector receive { model, view }; OutputControls receives { model, view, status: AppStatus | null, outputUrl: string }; AssetList receives { assets: AssetRecord[], warnings: AppError[] }. Export EditorModel as ReturnType<typeof createEditorModel> for these props. Components receive the same model/view instances. Inspector edits persistent state, not evaluated live transforms. No native/Three.js import belongs in editor model code.

- [x] **Step 1: Write numeric and conflict tests.**

~~~ts
import { expect, it } from "vitest";
import { parseFiniteNumber } from "./numeric";

it.each(["", " ", "NaN", "Infinity", "1e309"])("rejects %j", text => {
  expect(parseFiniteNumber(text))
    .toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
});
it("accepts a finite signed decimal", () => {
  expect(parseFiniteNumber("-1.25")).toEqual({ ok: true, data: -1.25 });
});
~~~

Use a typed test AppApi to force CONFLICT on an edit. Assert no success state or automatic retry; inspect the current scene and preserve a visible conflict indication. Test selection persistence when an unrelated frame arrives and no renderer object enters model state.

- [x] **Step 2: Run the failing tests.**

~~~sh
pnpm exec vitest run apps/desktop/src/editor/numeric.test.ts apps/desktop/src/editor/model.test.ts --project unit
~~~

- [x] **Step 3: Implement the model and compact panels.**

~~~ts
export function parseFiniteNumber(text: string): Reply<number> {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value)) {
    return { ok: false, error: { code: "INVALID_INPUT", message: "Invalid number", ids: [] } };
  }
  return { ok: true, data: value };
}
~~~

Use the latest inspected revision on a command. On success, reinspect persistent state. On conflict, reload state and return the conflict; the user must explicitly retry.

Hierarchy uses the shared selection model. Inspector exposes visibility and position with finite numeric validation. OutputControls selects camera_wide/camera_close and copies the output URL. AssetList shows registered assets and warnings from AppStatus. Add one output-status subscription to the integrator composition; no component opens its own session socket. Use shared Input, Select, Button, and other available primitives.

Use a CSS grid with hierarchy at left, viewport at center, inspector at right, assets below, and short output controls. Allow basic split resizing with accessible handles. Full docking, saved layouts, undo/redo, asset import UI, and graph UI belong to later slices. Do not add dead controls for them.

- [ ] **Step 4: Run logic and Svelte checks.**

~~~sh
pnpm exec vitest run apps/desktop/src/editor/numeric.test.ts apps/desktop/src/editor/model.test.ts --project unit
pnpm --filter @opensekai/desktop check
~~~

Exercise selection, a position edit, invalid input, visibility, camera change, and output URL copy in the running app after Task 10 composes the panels. Verify the same edits in OBS. Check keyboard focus order and panel resizing.

- [x] **Step 5: Checkpoint owned files.**

~~~sh
git add apps/desktop/src/editor apps/desktop/src/components apps/desktop/src/app.css
git diff --cached --check
git commit -m "feat: add scene inspector and output controls"
~~~

Return interaction results separately from unit tests.

## Task 8: Early MCP v2 server and evidence resources

**Owner:** MCP worker. **Depends on:** Task 6. **Can run with:** Tasks 7 and 9.

**Files:** Create apps/mcp/src/{server,tools,resources,cli,index}.ts; test/{tool-validation,stdio-roundtrip,descriptor}.test.ts; docs/mcp-client-setup.md as a worker handoff file. The integrator reviews docs before landing.

**Interfaces:** Consume AppApi, connectClient, ConnectionDescriptor, and BrowserClient.readResource. Produce parseOperatorDescriptor(input: unknown): Reply<ConnectionDescriptor> and createMcpServer(api: AppApi, readResource: (uri: string) => Promise<Uint8Array>): McpServer. cli.ts reads OPENSEKAI_CONNECTION_FILE and serves stdio. Its stdout contains only MCP messages.

- [x] **Step 1: Write tool and descriptor logic tests.**

~~~ts
import { expect, it } from "vitest";
import { parseOperatorDescriptor } from "../src/cli";

it("rejects renderer credentials for an operator server", () => {
  expect(parseOperatorDescriptor({
    schemaVersion: 1, sessionId: "s", httpOrigin: "http://127.0.0.1:41000",
    wsUrl: "ws://127.0.0.1:41000/ws", role: "renderer",
    token: "test", capabilities: [], outputId: "output_main"
  })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
});
~~~

Test unknown tool fields, stale scene revision, capture rate limits, invalid evidence URI, and a timed-out app connection. Do not grant edit/capture/benchmark because the CLI happens to be launched by an agent.

- [x] **Step 2: Run the failing tests.**

~~~sh
pnpm exec vitest run apps/mcp/test/tool-validation.test.ts apps/mcp/test/descriptor.test.ts --project unit
~~~

- [x] **Step 3: Register the exact tool mapping and resource access.**

~~~ts
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({ name: "opensekai", version: "0.1.0" });
server.registerTool("scene_inspect", {
  description: "Read the current persistent scene",
  inputSchema: z.strictObject({ sceneId: z.string().min(1) })
}, async params => ({
  content: [{ type: "text", text: JSON.stringify(await api.sceneInspect(params)) }]
}));
~~~

In cli.ts, after creating the server: await server.connect(new StdioServerTransport()). api is the AppApi passed into createMcpServer. cli.ts owns connect(), shutdown, and stderr logging; server.ts creates/registers the server without starting a second transport.

Tool names map directly: app_status → appStatus; scene_inspect → sceneInspect; scene_patch → scenePatch; camera_select → cameraSelect; capture_frame → captureFrame; benchmark_start/status/cancel → the matching AppApi methods; evidence_read → evidenceRead. Reuse strict schemas from contracts. Return domain errors as tool errors with structured codes.

Expose scene/status JSON resources and opaque registered evidence resources. Capture tools can return a bounded image content block plus capture metadata. Resolve only opensekai:// resources returned by the app; fetch bytes through authenticated readResource. No arbitrary URL/path fetch exists. Remove expired resource registrations.

Resources retain revision, tick, camera, backend, and hashes. Read-only sessions return FORBIDDEN on mutations and evaluation. On disconnect, return UNAVAILABLE rather than cached success.

- [x] **Step 4: Exercise a real stdio process using the official client.**

Create a test entry using a fixed typed AppApi fixture and launch it as a child process through the SDK client. This integration test is required to detect stdout corruption, JSON-RPC initialization errors, and shutdown leaks.

~~~ts
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "test/stdio-fixture.ts"]
});
const client = new Client({ name: "opensekai-test", version: "0.1.0" });
await client.connect(transport);
const listed = await client.listTools();
expect(listed.tools.map(tool => tool.name)).toContain("scene_inspect");
await client.close();
~~~

Add test/stdio-fixture.ts to the owned files. Call status, inspect, a bounded patch, and an error path; verify EOF and stderr handling. This tests the stdio boundary. The real app-to-OBS path is tested in Task 11.

~~~sh
pnpm exec vitest run apps/mcp/test/stdio-roundtrip.integration.test.ts --project integration
pnpm --filter @opensekai/mcp check
~~~

- [x] **Step 5: Checkpoint and hand off client setup.**

~~~sh
git add apps/mcp/src apps/mcp/test docs/mcp-client-setup.md
git diff --cached --check
git commit -m "feat: expose scene and evaluation APIs through MCP"
~~~

Document the descriptor file environment, launch command, local Node requirement, and granted capabilities. Do not include an actual token or credential-bearing output URL.

## Task 9: Bounded evaluation state and OBS evidence driver

**Owner:** evaluation worker. **Depends on:** Task 6. **Can run with:** Tasks 7 and 8.

**Files:** Create crates/evaluation/src/{lib,runs,captures}.rs and tests/lifecycle.rs; tools/evaluation/src/{obs,marker,run-smoke,rubric}.ts; tools/evaluation/test/{obs-policy,marker,evidence}.test.ts. Create docs/evaluation/rubric-v1.md. Native router wiring remains with the integrator in Task 10.

**Interfaces:** Consume shared run/capture/frame/error types. Produce:

~~~rust
pub struct RunManager;
impl RunManager {
    pub fn new() -> Self;
    pub fn start(&mut self, params: BenchmarkParams, now_ms: u64,
        output: &FrameApplied) -> Result<BenchmarkRun, AppError>;
    pub fn observe(&mut self, frame: &FrameApplied, now_ms: u64);
    pub fn status(&mut self, run_id: &str, now_ms: u64)
        -> Result<BenchmarkRun, AppError>;
    pub fn cancel(&mut self, run_id: &str)
        -> Result<BenchmarkRun, AppError>;
}
pub struct CaptureStore;
impl CaptureStore {
    pub fn new(session_id: String, app_commit: String, fixture_id: String) -> Self;
    pub fn insert(&mut self, client_id: &str, params: CaptureParams,
        frame: FrameApplied, png: Vec<u8>, received_at_ms: u64, now_ms: u64,
        created_at_utc: String) -> Result<CaptureRecord, AppError>;
    pub fn read(&self, evidence_id: &str) -> Result<&[u8], AppError>;
}
~~~

CaptureStore::new takes the named identity fields. insert also accepts received_at_ms from the native acknowledgement ring and created_at_utc: String from an injected UTC clock; tests supply a fixed UTC value. PNG codecs are pinned by Task 1. All freshness arithmetic uses native monotonic receive times, not uncalibrated browser clock values. RunManager stores metrics and summaries; export uses an explicit app-controlled evidence directory.

TypeScript exports connectObs(url: string): Promise<ObsAdapter>, decodeMarker(png: Uint8Array): Reply<DiagnosticMarker>, and evaluateSmoke(api: AppApi, obs: ObsAdapter, options: SmokeOptions): Promise<SmokeReport>. Create tools/evaluation/src/types.ts with these exact public types:

~~~ts
export interface ObsCounters {
  renderSkippedFrames: number; renderTotalFrames: number;
  outputSkippedFrames: number; outputTotalFrames: number;
}
export interface OwnedObsScene { sceneName: string; sourceName: string }
export interface SmokeOptions {
  profileId: BenchmarkParams["profileId"]; outputUrl: string;
  destinationDir: string; sceneName: string; sourceName: string;
}
export interface SmokeReport {
  runId: Id; appEvidenceIds: Id[];
  obsCaptureHashes: string[];
  checks: { name: string; result: "pass" | "fail" | "unknown"; detail: string }[];
  counterDelta: ObsCounters | null;
  markers: DiagnosticMarker[];
}
export interface ObsAdapter {
  readVersions(): Promise<{ obs: string; websocket: string; availableRequests: string[] }>;
  readVideo(): Promise<{ width: number; height: number; fps: number }>;
  readStats(): Promise<ObsCounters>;
  screenshot(sourceName: string): Promise<Uint8Array>;
  withOwnedScene<T>(options: SmokeOptions,
    action: (owned: OwnedObsScene) => Promise<T>): Promise<T>;
  disconnect(): Promise<void>;
}
~~~

The CLI reads operator and renderer descriptors from explicit environment file paths, validates matching session IDs, and derives outputUrl without logging the ticket. It exports sanitized hashes and result fields only.

- [x] **Step 1: Write time, cancellation, eviction, and evidence tests.**

~~~rust
#[test]
fn a_cancelled_run_is_terminal() {
    let mut runs = RunManager::new();
    let started = runs.start(smoke_params("request_1"), 0, &valid_output()).unwrap();
    let cancelled = runs.cancel(&started.id).unwrap();
    assert_eq!(cancelled.state, RunState::Cancelled);
    assert_eq!(runs.status(&started.id, 200_000).unwrap().state, RunState::Cancelled);
}
~~~

Define these fixtures in tests/lifecycle.rs:

~~~rust
fn smoke_params(request_id: &str) -> BenchmarkParams {
    serde_json::from_value(serde_json::json!({
        "requestId": request_id, "fixtureId": "smoke_v1",
        "profileId": "webgl2_smoke_v1"
    })).unwrap()
}
fn valid_output() -> FrameApplied {
    serde_json::from_str(include_str!(
        "../../../fixtures/protocol/valid-applied.json"
    )).unwrap()
}
~~~

They are test fixtures, not production exports. Test warmup exclusion, idempotent requestId, second active run BUSY, wrong backend, output loss, 120-second measurement, cancellation, and terminal progress. Capture tests cover wrong revision, expired frame, wrong output, oversize PNG, per-client rate, and ninth-record eviction.

TypeScript tests cover missing OBS, unrelated source marker, malformed PNG, missing auth/request capability, cleanup on failure, and counter-reset detection. Counter resets produce unknown/error, not negative skipped percentages.

- [x] **Step 2: Run the failing tests.**

~~~sh
cargo test -p opensekai-evaluation
pnpm exec vitest run tools/evaluation/test/obs-policy.test.ts tools/evaluation/test/marker.test.ts tools/evaluation/test/evidence.test.ts --project unit
~~~

- [x] **Step 3: Implement the fixed run state machine and capture budgets.**

~~~rust
// Transition decisions use the injected monotonic clock.
let elapsed = now_ms.saturating_sub(started_at_ms);
let state = if elapsed < 30_000 {
    RunState::Warming
} else if elapsed < 150_000 {
    RunState::Measuring
} else {
    RunState::Complete
};
~~~

The snippet is the time policy inside RunManager; cancellation/failure are terminal and override time transitions. Start only with a connected, current output whose backend matches profileId. Accept only smoke_v1 and the two named profiles. Same requestId plus same parameters returns the same run; changed parameters with the same ID return CONFLICT.

Observe capture-free renderer acknowledgements only during the measurement window. Summaries include count, interval/CPU percentiles, GPU unknowns, stale output periods, and resource warnings. Do not claim hardware acceptance. Native integration adds a periodic timer so a disconnected output can fail a run without new observations.

CaptureStore validates PNG signature, dimensions, bytes, freshness, output/session, and revision before acceptance. Dimensions must be positive and at most 1920 × 1080. Its stored native receive time validates the 500 ms age limit. Retain eight records, evict oldest bytes/references, and return NOT_FOUND for expired resources. Exports use opaque IDs and hashes. Do not keep PNG base64 in metrics logs.

- [x] **Step 4: Implement controlled OBS setup and evidence collection.**

~~~ts
import OBSWebSocket from "obs-websocket-js";
const obs = new OBSWebSocket();
await obs.connect("ws://127.0.0.1:4455");
const before = await obs.call("GetStats");
const video = await obs.call("GetVideoSettings");
~~~

Check GetVersion.availableRequests before operations. The adapter owns uniquely named test scenes/sources, remembers prior scene selection, and restores it in a finally block. Do not delete or reconfigure a pre-existing source with the same name; choose a fresh name.

Use GetSourceScreenshot for the owned browser source and composed test scene. Collect dark, light, and checker compositions. Decode the diagnostic marker from the real source PNG. Validate sessionTag, revision, cameraTag, and tick progression. Actual OBS captures can occur a few ticks after the app capture; label both ticks and enforce the 500 ms freshness window. A wrong source or stale frame fails correlation.

The run driver separates screenshots from timing. During a benchmark, sample OBS stats at start/end and collect a short recording only in a separate recording phase. Refuse to switch test scenes or start a recording if OBS is currently streaming or recording. Keep the report explicit about an unavailable encoder/GPU measurement.

- [x] **Step 5: Verify logic and checkpoint owned files.**

~~~sh
cargo test -p opensekai-evaluation
pnpm exec vitest run tools/evaluation/test/obs-policy.test.ts tools/evaluation/test/marker.test.ts tools/evaluation/test/evidence.test.ts --project unit
pnpm --filter @opensekai/evaluation check
git add crates/evaluation/src crates/evaluation/tests tools/evaluation/src tools/evaluation/test docs/evaluation/rubric-v1.md
git diff --cached --check
git commit -m "feat: add bounded evaluation and OBS evidence collection"
~~~

The rubric requires capture IDs, defect locations, intended approximation differences, and deterministic gate results. Record model/prompt versions when a frontier client uses it. No model-provider SDK or automatic upload is required.

## Task 10: Wire evaluation and editor, then verify the MCP loop

**Owner:** integrator. **Depends on:** Tasks 7, 8, and 9 merged individually.

**Files:** Modify apps/desktop/src/App.svelte, src/bootstrap.ts; src-tauri/src/lib.rs and service/router.rs; create src-tauri/src/evaluation.rs and tests/evaluation_integration.rs. Add docs/evaluation/macOS-feasibility/mcp-roundtrip.md. Update root manifests/lockfiles only if an approved helper dependency is needed.

**Interfaces:** Install native handlers for captureFrame, benchmarkStart/Status/Cancel, and evidenceRead. BrowserClient.readResource resolves only app-managed evidence URIs. Native evaluation exports evidence files atomically inside ServiceConfig.evidence_root.

- [x] **Step 1: Add real capture/run boundary tests before native wiring.**

The integration test uses the real local service with a controlled publisher/renderer test peer. It starts a benchmark, submits acknowledgements, cancels, and verifies terminal state. It submits a bounded PNG capture, reads the returned resource, then tests wrong output/revision, timeout, eviction, and unauthenticated resource access.

A fixed renderer peer is valid for protocol tests. It is not evidence of GPU rendering or OBS presentation.

~~~sh
cargo test -p opensekai-desktop --test evaluation_integration
~~~

Expected: evaluation routes are initially UNSUPPORTED; tests fail against the intended successful path.

- [x] **Step 2: Install the native evaluation bridge.**

~~~rust
match call.method.as_str() {
    "captureFrame" => evaluation.capture(call, context).await,
    "benchmarkStart" | "benchmarkStatus" | "benchmarkCancel" =>
        evaluation.run(call, context).await,
    "evidenceRead" => evaluation.evidence(call, context).await,
    _ => route_scene_call(call).await,
}
~~~

Define NativeEvaluation::new with the service ports, RunManager, CaptureStore, and native clock/commit/evidence context. Its capture/run/evidence methods each accept Call and RpcContext and return Reply<serde_json::Value>. Use RpcContext.client_id for per-client capture budgets and ServiceHandle::now_ms for the shared native clock. Register their dispatch closure through ServiceHandle::install_evaluation_handler.

The native module defines these exact bridge methods using the shared Call/Reply wire types and existing service ports. Keep scope checks ahead of dispatch. Status remains native-owned.

capture selects the authenticated output client, checks current revision, sends a request, waits at most 2 seconds, looks up the capture sequence in applied_at, and validates matching frame metadata and returned image through CaptureStore. Missing sequence or a native age above 500 ms returns STALE_FRAME. Keep a single global capture in flight, per-client rate limits, and the 3 MiB encoded diagnostic message limit. Never mix capture traffic into ordinary pose queues.

Runs use monotonic time and observe the selected output only. Fail a run if no current acknowledgement arrives for 500 ms while measuring. A 100 ms native timer advances lifecycle and detects loss. Benchmark requests must match the loaded fixture ID/hash and actual backend. Return explicit conflicts when fixture or profile is wrong.

Evidence resources use opensekai://evidence/<id>/image.png or /summary.json. Map them to registered files/bytes internally. No relative or arbitrary path component is accepted. Keep appCommit and UTC metadata consistent with the build and source revision.

- [x] **Step 3: Compose the editor panels and lifecycle.**

~~~svelte
<script lang="ts">
  import Hierarchy from "./components/Hierarchy.svelte";
  import Inspector from "./components/Inspector.svelte";
  import OutputControls from "./components/OutputControls.svelte";
  import AssetList from "./components/AssetList.svelte";
</script>
~~~

Pass the model/view and bootstrap values into these components. Keep viewport canvas lifecycle outside the model. Close subscriptions and worker/service handles on app exit. Disconnected output gets an explicit state and cannot satisfy a capture request.

- [x] **Step 4: Run tests and a real MCP-to-OBS edit/capture sequence.**

~~~sh
pnpm test:unit
cargo test --workspace
pnpm check
pnpm build:mac
~~~

Launch the release app with evaluation mode explicitly enabled. Launch MCP using the operator descriptor file. Use the official client to call app_status, scene_inspect, scene_patch, camera_select, capture_frame, benchmark_start/status/cancel, and evidence_read.

Expected: revision increments once for the edit; selected camera reaches output_main; actual OBS source shows the edit; captures/resources identify the correct session, revision, tick, camera, and backend. Read-only mode rejects edits/evaluation. A stale edit returns CONFLICT. Captures return current images rather than an app preview substituted for OBS evidence.

Record the bounded first evaluation loop in mcp-roundtrip.md. Large images stay in artifacts/. A model client can read image resources and the rubric; no automated model API call is required to pass this loop.

- [x] **Step 5: Checkpoint the complete slice wiring.**

~~~sh
git add apps/desktop/src/App.svelte apps/desktop/src/bootstrap.ts apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/service/router.rs apps/desktop/src-tauri/src/evaluation.rs apps/desktop/src-tauri/tests/evaluation_integration.rs docs/evaluation/macOS-feasibility/mcp-roundtrip.md Cargo.lock pnpm-lock.yaml
git diff --cached --check
git commit -m "feat: integrate editor MCP and evaluation services"
~~~

## Task 11: macOS feasibility gate and next-slice handoff

**Owner:** integrator with frontier review of evidence. **Depends on:** Task 10.

**Files:** Complete tools/evaluation/src/run-smoke.ts; add docs/evaluation/macOS-feasibility/results.md and evidence-manifest.json. Modify docs/warudo-parity.md and README.md. Create the concert-foundation analysis only if this feasibility gate passes.

**Interfaces:** Consume the real app, MCP client, and OBS adapter. Produce a reproducible result summary tied to commit, fixture hashes, backend, power mode, browser/webview, and OBS versions.

- [x] **Step 1: Freeze the smoke fixture and review expected behavior.**

The fixture includes a transparent clear, reference GLB, real VRM1, procedural marker, camera_wide/camera_close, and separate output_main/preview_main outputs. Geometry/material/texture counts and active effects are recorded. Spring physics, tracking, hall lighting, graph UI, and guest code are disabled.

Use profile webgpu_smoke_v1 only when the actual renderer uses WebGPU. Use webgl2_smoke_v1 for forced fallback. Reject mislabeled runs. VRM0 receives a separate compatibility result when a licensed fixture exists.

The two output IDs in makeSmokeScene use the same nominal 1920 × 1080/60 specification. Preview profile halves pixel size and caps display refresh to 15 FPS. Capture metadata reports actual dimensions.

- [ ] **Step 2: Execute the release app and full interaction path.**

~~~sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:unit
cargo test --workspace
pnpm build:mac
~~~

Open the local release .app with working directory outside the repo. Through the editor, select the performer, change position/visibility, reject invalid input, switch camera, resize panels, and inspect output status. Repeat one edit through MCP and compare OBS. Reload the renderer and verify current state returns within 2 seconds.

Use computer-use for the actual UI interactions. Use OBS WebSocket for source control and screenshots. Record which flows were exercised; screenshots alone are insufficient.

- [x] **Step 3: Run repeatable timing and minimized-window checks.**

~~~sh
pnpm evaluate:smoke -- --profile webgl2_smoke_v1 --repeats 3
pnpm evaluate:smoke -- --profile webgpu_smoke_v1 --repeats 3
~~~

The script supports these explicit options. Each run has 30 seconds warmup and 120 seconds measurement. During measurement: 30 seconds with editor visible, 45 seconds minimized, 45 seconds restored. A local operator/computer-use action performs minimize/restore at recorded times. The script records transitions; elapsed time alone does not establish that a window was minimized.

Keep the 120-second timing window free of screenshots/readback. After timing, make a separate 20-second local recording: 5 seconds visible, 10 minimized, 5 restored. Decode representative frames at 2 FPS to verify actual marker progression throughout the minimized interval. Check actual moving output through those decoded OBS marker frames. Marker ticks must advance while minimized. A renderer that submits the same texture repeatedly fails even if OBS reports 60 FPS.

Proposed smoke gates: no reproducible steady stall over 100 ms; fewer than 0.1% OBS render-skipped frames in the measured window; p95 render CPU work below 12 ms; no current-state loss while minimized; reconnect within 2 seconds. Report GPU p95 when available and keep unknown GPU timing explicit. These gates test the small fixture only.

If WebGPU is unavailable in the actual runtime, record UNSUPPORTED for that profile and do not check WebGPU parity. Forced WebGL 2 must work for the portable feasibility path. If neither backend or the minimized session works, fail the slice and write a boundary-revision spec before adding concert scope.

- [x] **Step 4: Check alpha, source lifecycle, resource cleanup, and evidence review.**

Use dark/light/checker composites and full-resolution raw source PNG to verify clear alpha and silhouette. Exclude the fixed diagnostic-marker region when testing transparent background pixels. Record observed material/outline differences. Hide/restore the source with both shutdown disabled and enabled; distinguish configured source restart from a session failure.

Run a ten-minute smoke soak with repeated camera changes, renderer reconnect, five asset reloads, and one cancelled benchmark. Check that resource counts and queues return to baseline after reload. A ten-minute smoke result is separate from the later thirty-minute concert gate.

Give the frontier reviewer the versioned rubric, real OBS images/recording, app captures, metrics, and manifest. Require capture IDs and reproducible defect descriptions. Numeric thresholds determine timing pass/fail. If no frontier client is available, save a ready evidence packet and mark model review pending; do not claim it occurred.

- [x] **Step 5: Update scoped parity and checkpoint the result.**

Keep large evidence under artifacts/evaluation/<run-id>/. Commit only sanitized summaries, hashes, and fixture metadata. Never include tickets, descriptor files, absolute private asset paths, or model credentials.

Possible checked entries, only after their full defined behavior passes: CAM-04 transparent output, OSE-05 minimized output, and OSE-06 early MCP. Other entries usually remain unchecked or must be split: CHR-01/ MAT-01 need precise VRM/PBR coverage; CAM-01/02 need the documented controls; OSE-01 must state this is a feasibility production path; OSE-07 is checked only after actual model review. Add evidence rows with remaining gaps. Keep OSE-04 concert/minimum-hardware acceptance unchecked.

~~~sh
git add tools/evaluation/src/run-smoke.ts docs/evaluation/macOS-feasibility docs/warudo-parity.md README.md
git diff --cached --check
git commit -m "test: record macOS feasibility results and parity evidence"
~~~

A failed gate can receive an evidence checkpoint. The feature remains incomplete. Do not mark the gate passed to keep the roadmap moving.

## Checkpoints and worker handoff

Use branch opensekai/macos-feasibility for integration. Worker branch names are opensekai/native, /session, /renderer, /editor, /mcp, and /evaluation. Create worktrees through the using-git-worktrees skill at execution time, rooted in .worktrees/. Do not change the ai-native agent root.

For each task, the worker handoff contains:

~~~json
{
  "task": 3,
  "commit": "worker commit SHA",
  "ownedFiles": ["apps/desktop/src-tauri/src/service/mod.rs"],
  "checks": [{"command": "cargo test -p opensekai-desktop service", "result": "pass"}],
  "limitations": [],
  "parityProposal": [],
  "contractChangeRequested": false
}
~~~

The fields define the handoff shape. Replace the illustrated commit value with the worker’s actual commit when executing the plan. Make checkpoints after coherent checked units, normally within 30–60 minutes of active implementation. Request an interface change before coding around a mismatch. The root merges one lane at a time and applies related parity/evidence updates before making its verified integration checkpoint.

During execution, use a fresh reviewer for each bounded deliverable according to the subagent-driven-development skill, then a whole-slice review. Concurrency is for independent implementation; contract changes and integration remain sequential. Do not run live OBS control from multiple agents at once. One evaluation owner holds that resource.

## Follow-up plans

| Next slice | Deliverable | Entry gate |
| --- | --- | --- |
| Concert foundation | Frozen real hall, two rigs, authoritative bone/spring evaluation, lighting/screen budgets, measured ECS and transport | macOS feasibility passes |
| External tracking | VMC receive and iFacialMocap receive with calibration/source assignment | Stable session/rig contract |
| Show persistence and editing | Versioned files, atomic saves, repair, undo/redo, layout persistence | Stable entity/asset IDs |
| Graph and show behavior | Typed scheduler, animation layers, IK, props, screens, director; visual graph UI follows core | Session and editor contracts |
| Sandbox and authoring | JS/TS isolation tests, SDK, Blender/Unity adapters | Capability API and guest limits |
| Broader parity/platforms | Additional protocols, material coverage, production integrations, Windows acceptance | Maintained feature evidence |

Write each as a separate SPDD slice and implementation plan. Mobile experiments, NDI, and full shader support remain in their roadmap entries. No absent follow-up task is implied to be implemented by this first plan.

## Plan review record

Self-review coverage:

| Slice requirement | Tasks |
| --- | --- |
| F1 desktop shell | 1, 6, 7, 11 |
| F2 renderer/backend/MToon | 5, 11 |
| F3 actual OBS alpha and frame delivery | 6, 9, 11 |
| F4 one worker and minimized behavior | 4, 6, 11 |
| F5 versioned IDs/revisions/ticks | 2, 3, 4, 5 |
| F6 GLB/VRM fixture and source terms | 3, 5, 11 |
| F7 common edits and camera API | 2, 4, 7, 8 |
| F8 early MCP tool surface | 8, 10, 11 |
| F9 capture and smoke benchmark | 5, 9, 10, 11 |
| F10 recovery and invalid input | 2, 3, 4, 5, 8, 9, 10, 11 |
| F11 role/capability boundary | 2, 3, 8, 10 |
| F12 concurrent workers/checkpoints | execution graph and each task |

The original plan review assigned tests to all five Review Focus classes. It defined pending or unsupported outcomes for VRM0, unavailable WebGPU, absent model review, concert hardware and broader parity. The checkpoint status below records the actual implementation and evidence results.

The user approved execution on 2026-10-03. Implementation is in progress. The selected method is concurrent agents at lower effort with separate worktrees; do not ask the user to choose that method again.

## Historical checkpoint status — through 1073130

Tasks 6–10 have source, boundary, and release tool evidence in the macOS feasibility documents. Task 7 still has an incomplete clipboard check. Task 11 remains incomplete. Two correctly minimized WebGPU failures remain evidence; six later c5e107a runs passed the timing gates. See [current results](../../evaluation/macOS-feasibility/results.md). The native wakeup correction in the slice contract takes precedence over the earlier worker-timer example. The next concert slice must wait for clipboard UI acceptance and the scoped acceptance checkpoint. Technical smoke checks do not establish concert or minimum-hardware performance.

Timing checkpoint at c5e107a: three qualifying runs each on WebGPU and WebGL2 passed on the measured smoke host. Both earlier failures remain evidence. Task 11 Step 3 is now checked: the separate c5e107a recording passed 40 sampled session markers with 18 advancing minimized samples. Correlated hide/recreate lifecycle v2 also passed. At 1073130, in-document refresh and the 600002 ms/five-reload soak passed. Step 4 is checked with the stable scoped final model packet; GPU reclamation remains unknown. Step 2 remains unchecked for clipboard UI acceptance. Step 5 records the technical evidence checkpoint and the remaining UI exception. Clipboard testing still needs explicit authorization. Exact results and action timestamps are indexed in the feasibility results.

## Later UI acceptance checkpoint — ce6bccb

The user explicitly authorized OBS URL copying. The actual control and private clipboard comparison passed at 68b9293 and ce6bccb. The [Warudo editor interaction report](../../evaluation/warudo-editor-interactions.md) records the completed first UI slice, final targeted minimized WebGPU check, retained unsuccessful attempts and remaining live cancellation limit. Earlier clipboard-pending statements describe the historical checkpoint. This later check does not establish concert or minimum-hardware performance.
