# Environment Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One environment in each scene, imported from a local `.glb`, `.gltf` with its files, or `.zip`, drawn behind the characters with neutral environment lighting and a Render Environment switch on each camera.

**Architecture:** The Rust host packs every external buffer and image into one self-contained GLB at import (`assets/scene_import.rs`), so the asset service, `validate_glb`, and the renderer `inspectContainer` keep their no-URI checks. The contracts add an `environment` entity kind, a camera `renderEnvironment` flag, two patch operations, and optional asset `credits`. The renderer loads the environment through the existing background load jobs and sets a PMREM `RoomEnvironment` map on the environment materials only.

**Tech Stack:** Rust (Tauri 2, serde_json, `zip` 9.0.3, `percent-encoding` 2.3.2, `base64`, `url`), TypeScript (zod, three.js 0.180 WebGPU, Svelte 5, `@oshi-connect/ui`), vitest, cargo test.

**Spec:** [docs/superpowers/specs/2026-10-13-environment-import-design.md](../specs/2026-10-13-environment-import-design.md) and the REASONS contract [spdd/prompt/2026-10-13-environment-import.md](../../../spdd/prompt/2026-10-13-environment-import.md) (R1–R26). Read both before Task 1. Also read [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Global Constraints

- Work on branch `opensekai/environment-import`. Run commands from the repository root `/Users/danirukun/ghq/github.com/oshi-connect/opensekai`. Do not use `git -C` or compound `cd` commands.
- Use pnpm only. TypeScript checks: `pnpm check`, `pnpm test:unit`, `pnpm test:integration`. Rust checks: `cargo test -p opensekai-contracts` and `cargo test -p opensekai-desktop`.
- `schemaVersion` stays 1. Existing shows and library records must load without change.
- Packed GLB limit: `MAX_IMPORT_BYTES = 256 * 1024 * 1024` for every import, VRM included. GLB JSON limit stays `16 * 1024 * 1024`.
- Zip limits: at most 4096 entries, at most 1 GiB (`1 << 30`) uncompressed.
- Rust contracts compare key sets exactly (`shape` in `crates/contracts/src/lib.rs`). An optional key must be absent when unset, never `null`: use `#[serde(default, skip_serializing_if = "Option::is_none")]` in Rust and `.optional()` in zod.
- Do not loosen `validate_glb`, `inspectContainer`, or the `/assets/{id}` checks. Do not accept a file path from the frontend or MCP.
- Do not set `scene.environment`. Do not change avatar materials. Do not import `KHR_lights_punctual` lights.
- UI copy is limited to: `Environment`, `Source`, `Choose model…`, `Missing model`, `Import file…`, `Importing…`, `Title`, `Author`, `License`, `Copy credit`, `Copied`, `Render Environment`, `Could not import model`. Use `@oshi-connect/ui` controls where the kit has them; follow the existing native checkbox pattern for boolean rows.
- Prose (commit bodies, docs, evaluation) in ASD-STE100. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg
  ```
- A value that is not measured is unknown, never zero.

## Review Focus

1. **A zip made by macOS Finder** has `__MACOSX/._scene.gltf` next to `scene.gltf`. The importer must ignore `__MACOSX/` and still find exactly one root. Test: Task 3 `zip_ignores_macos_resource_forks`.
2. **Texture names with spaces and non-ASCII characters**, percent-encoded in the URI (`textures/Room%20color.png`, `%E8%89%B2.png`), must resolve. Test: Task 3 `packs_multi_file_gltf` and `resolves_non_ascii_names`.
3. **Duplicate on the environment** in the Hierarchy menu must be disabled, and a second environment must fail in the session. Test: Task 2 `rejects a second environment`; Task 6 `budgetFull` change.
4. **Cancel after `Import file…`** must leave the Source select on the current value and send no patch. Test: Task 6 `sourceAction` unit test.
5. **The preview and OBS use different cameras**: each client follows its own output camera flag. Test: Task 5 `follows the flag of its own output camera`.

---

### Task 1: Contracts for the environment, the camera flag, operations, and credits

**Files:**
- Modify: `packages/contracts/src/schema.ts` (SceneEntitySchema, SceneViewSchema refine, PatchOpSchema, AssetRecordSchema)
- Modify: `packages/contracts/src/types.ts` (SceneEntity, LivePatchOp, AssetRecord, new AssetCredits)
- Modify: `crates/contracts/src/lib.rs` (SceneEntity, PatchOp, AssetRecord, AssetCredits, SceneView validate, AssetRecord validate)
- Modify: `fixtures/protocol/validation-vectors.json` (three invalid vectors; both runners treat a non-wire vector as invalid, so valid cases go in the new test files)
- Create: `packages/contracts/test/environment.test.ts`
- Create: `crates/contracts/tests/environment.rs`

**Interfaces:**
- Produces (TS): `SceneEntity` member `{ kind: 'environment'; assetId: Id | null } & EntityBase`; camera member gains `renderEnvironment?: boolean`; `PatchOp` members `{ kind: 'setEnvironmentModel'; entityId: Id; assetId: Id | null }` and `{ kind: 'setCameraRenderEnvironment'; entityId: Id; renderEnvironment: boolean }`; `AssetCredits = { title: string | null; author: string | null; license: string | null; sourceUrl: string | null }`; `AssetRecord.credits?: AssetCredits`; `AssetCreditsSchema`.
- Produces (Rust): `SceneEntity::Environment { id, name, visible, transform, asset_id: Option<Id> }`; `SceneEntity::Camera { .., render_environment: Option<bool> }`; `PatchOp::SetEnvironmentModel { entity_id, asset_id: Option<Id> }`; `PatchOp::SetCameraRenderEnvironment { entity_id, render_environment: bool }`; `pub struct AssetCredits { pub title, pub author, pub license, pub source_url: Option<String> }`; `AssetRecord.credits: Option<AssetCredits>`.

- [ ] **Step 1: Write the failing TypeScript tests**

Create `packages/contracts/test/environment.test.ts`:

```ts
import { expect, it } from 'vitest';
import { AssetRecordSchema, PatchOpSchema, SceneViewSchema, makeSmokeScene, type SceneEntity } from '../src/index';
const environment = (id: string): SceneEntity => ({ id, name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null });
const record = { id: 'scene_' + 'a'.repeat(64), format: 'glb', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name: 'Room' };
it('accepts one environment and rejects a second one', () => {
    const scene = makeSmokeScene();
    scene.entities.push(environment('stage'));
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    scene.entities.push(environment('stage_2'));
    expect(SceneViewSchema.safeParse(scene).success).toBe(false);
});
it('accepts a camera with and without the Render Environment flag', () => {
    const scene = makeSmokeScene();
    const camera = scene.entities.find(entity => entity.kind === 'camera')!;
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    if (camera.kind === 'camera') camera.renderEnvironment = false;
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
});
it('parses both environment operations', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setEnvironmentModel', entityId: 'stage', assetId: null }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setEnvironmentModel', entityId: 'stage', assetId: 'scene_a' }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setCameraRenderEnvironment', entityId: 'camera_wide', renderEnvironment: false }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setCameraRenderEnvironment', entityId: 'camera_wide' }).success).toBe(false);
});
it('accepts records with and without credits and rejects null credits', () => {
    expect(AssetRecordSchema.safeParse(record).success).toBe(true);
    expect(AssetRecordSchema.safeParse({ ...record, credits: { title: 'Room', author: null, license: 'CC-BY-4.0', sourceUrl: 'https://sketchfab.com/3d-models/room' } }).success).toBe(true);
    expect(AssetRecordSchema.safeParse({ ...record, credits: null }).success).toBe(false);
    expect(AssetRecordSchema.safeParse({ ...record, credits: { title: null, author: null, license: null, sourceUrl: 'ftp://example.com/room' } }).success).toBe(false);
    expect(AssetRecordSchema.safeParse({ ...record, credits: { title: null, author: null, license: null } }).success).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit packages/contracts/test/environment.test.ts`
Expected: FAIL. TypeScript type errors on `kind: 'environment'` are acceptable at this point; vitest reports failed assertions for the second environment and the new operations.

- [ ] **Step 3: Implement the TypeScript contract**

In `packages/contracts/src/schema.ts`, add the environment member before the camera member of `SceneEntitySchema`, and the flag to the camera member:

```ts
    EntityBaseSchema.extend({
        kind: z.literal("environment"),
        assetId: IdSchema.nullable()
    }),
    EntityBaseSchema.extend({
        kind: z.literal("camera"),
        lens: LensSchema,
        renderEnvironment: z.boolean().optional()
    })
```

In the `SceneViewSchema` refine, after the line `const sources=...`, add:

```ts
 if(s.entities.filter(e=>e.kind==='environment').length>1)return false;
```

In `PatchOpSchema`, after the `setAvatarModel` member, add:

```ts
    z.strictObject({kind:z.literal('setEnvironmentModel'),entityId:IdSchema,assetId:IdSchema.nullable()}),
    z.strictObject({kind:z.literal('setCameraRenderEnvironment'),entityId:IdSchema,renderEnvironment:z.boolean()}),
```

Before `AssetRecordSchema`, add, and add the key to the record:

```ts
const creditText = z.string().nullable();
export const AssetCreditsSchema = z.strictObject({
    title: creditText,
    author: creditText,
    license: creditText,
    sourceUrl: z.url().refine(value => /^https?:\/\//.test(value), 'Invalid source URL').nullable()
});
```

```ts
    name: z.string().refine(name => name.trim().length > 0 && name.length <= 128, 'Invalid asset name'),
    credits: AssetCreditsSchema.optional()
```

In `packages/contracts/src/types.ts`:
- Add to the `SceneEntity` union, before the camera member: `| (EntityBase & { kind: "environment"; assetId: Id | null; })`.
- Add `renderEnvironment?: boolean;` to the camera member.
- Append to `LivePatchOp`: `|{kind:'setEnvironmentModel';entityId:Id;assetId:Id|null}|{kind:'setCameraRenderEnvironment';entityId:Id;renderEnvironment:boolean}`.
- Add `export interface AssetCredits { title: string | null; author: string | null; license: string | null; sourceUrl: string | null; }` and `credits?: AssetCredits;` on `AssetRecord`.

Export `AssetCreditsSchema` and `AssetCredits` from `packages/contracts/src/index.ts` if that file lists exports by name (check with `grep -n "AssetRecordSchema" packages/contracts/src/index.ts`; if it uses `export *`, no change).

- [ ] **Step 4: Run the TypeScript test and the type check**

Run: `pnpm vitest run --project unit packages/contracts/test/environment.test.ts && pnpm check`
Expected: the test passes. `pnpm check` may now report non-exhaustive `kind` handling in other packages (renderer, session, editor). Record those locations; Tasks 2, 5, and 6 change them. If a failure is outside those packages (for example `apps/mcp` or `tools/evaluation`), fix it here with the smallest change that keeps behavior for existing kinds.

- [ ] **Step 5: Write the failing Rust test**

Create `crates/contracts/tests/environment.rs`:

```rust
use opensekai_contracts::{validate_value, AssetRecord, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(extra: Vec<Value>) -> Value {
    let camera = json!({"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}});
    let mut entities = vec![camera];
    entities.extend(extra);
    json!({"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":entities,"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]})
}
fn environment(id: &str) -> Value {
    json!({"id":id,"name":"Environment","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"environment","assetId":null})
}
fn record() -> Value {
    json!({"id":format!("scene_{}", "a".repeat(64)),"format":"glb","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"","importerVersion":1,"name":"Room"})
}
#[test]
fn one_environment_is_valid_and_two_are_not() {
    assert!(validate_value::<SceneView>(&scene(vec![environment("stage")])).is_ok());
    assert!(validate_value::<SceneView>(&scene(vec![environment("stage"), environment("stage_2")])).is_err());
}
#[test]
fn environment_requires_the_asset_key() {
    let mut entity = environment("stage");
    entity.as_object_mut().unwrap().remove("assetId");
    assert!(validate_value::<SceneView>(&scene(vec![entity])).is_err());
}
#[test]
fn camera_flag_is_optional_and_round_trips() {
    let plain = validate_value::<SceneView>(&scene(vec![])).unwrap();
    assert!(!serde_json::to_string(&plain).unwrap().contains("renderEnvironment"));
    let mut flagged = scene(vec![]);
    flagged["entities"][0]["renderEnvironment"] = json!(false);
    let parsed = validate_value::<SceneView>(&flagged).unwrap();
    assert!(serde_json::to_string(&parsed).unwrap().contains("\"renderEnvironment\":false"));
}
#[test]
fn environment_operations_parse() {
    let patch = json!({"sceneId":"scene_smoke","expectedRevision":0,"operations":[
        {"kind":"setEnvironmentModel","entityId":"stage","assetId":null},
        {"kind":"setEnvironmentModel","entityId":"stage","assetId":"scene_a"},
        {"kind":"setCameraRenderEnvironment","entityId":"camera_main","renderEnvironment":false}]});
    assert!(validate_value::<ScenePatch>(&patch).is_ok());
}
#[test]
fn credits_are_optional_and_never_null() {
    assert!(validate_value::<AssetRecord>(&record()).is_ok());
    let mut with = record();
    with["credits"] = json!({"title":"Room","author":null,"license":"CC-BY-4.0","sourceUrl":"https://sketchfab.com/3d-models/room"});
    assert!(validate_value::<AssetRecord>(&with).is_ok());
    let mut null = record();
    null["credits"] = Value::Null;
    assert!(validate_value::<AssetRecord>(&null).is_err());
    let mut ftp = record();
    ftp["credits"] = json!({"title":null,"author":null,"license":null,"sourceUrl":"ftp://example.com/room"});
    assert!(validate_value::<AssetRecord>(&ftp).is_err());
}
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cargo test -p opensekai-contracts --test environment`
Expected: FAIL to compile or fail on `unknown variant environment`.

- [ ] **Step 7: Implement the Rust contract**

In `crates/contracts/src/lib.rs`:

Add to `SceneEntity`, before `Camera`:

```rust
    Environment {
        id: Id,
        name: String,
        visible: bool,
        transform: Transform,
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
    },
```

Add to the `Camera` variant after `lens: Lens,`:

```rust
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            rename = "renderEnvironment"
        )]
        render_environment: Option<bool>,
```

Add `| Self::Environment { id, .. }` to `SceneEntity::id` and `| Self::Environment { transform, .. }` to `SceneEntity::transform`.

Add to `PatchOp` after `SetAvatarModel`:

```rust
    SetEnvironmentModel {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
    },
    SetCameraRenderEnvironment {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "renderEnvironment")]
        render_environment: bool,
    },
```

Replace the `object!(AssetRecord {...});` line with:

```rust
object!(AssetCredits {
    title: Option<String>,
    author: Option<String>,
    license: Option<String>,
    source_url: Option<String>
});
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRecord {
    pub id: Id,
    pub format: AssetFormat,
    pub sha256: String,
    pub bytes: u64,
    pub source_url: Option<String>,
    pub license_label: String,
    pub importer_version: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<AssetCredits>,
}
```

In `impl Validate for SceneView`, after the `"too many live entities"` `require`, add:

```rust
        require(
            self.entities
                .iter()
                .filter(|e| matches!(e, SceneEntity::Environment { .. }))
                .count()
                <= 1,
            "too many environments",
        )?;
```

In `impl Validate for AssetRecord`, before `hash(&self.sha256)`, add:

```rust
        require(
            self.credits
                .as_ref()
                .and_then(|c| c.source_url.as_ref())
                .is_none_or(|s| {
                    url::Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
                }),
            "invalid credits source URL",
        )?;
```

Add `credits: None,` to every other `AssetRecord { ... }` literal that the compiler reports (`apps/desktop/src-tauri/src/assets/registry.rs` `import_avatar`, and any test literal).

- [ ] **Step 8: Add shared invalid vectors**

Append to the array in `fixtures/protocol/validation-vectors.json` (both runners treat a non-wire vector as an invalid payload):

```json
{"name":"two-environments","target":"scene","valid":false,"errorCode":"INVALID_INPUT","payload":{"schemaVersion":1,"sceneId":"scene_smoke","revision":0,"entities":[{"id":"camera_main","name":"Camera","visible":true,"transform":{"position":[0,1.2,3],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}},{"id":"stage","name":"Environment","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"environment","assetId":null},{"id":"stage_2","name":"Environment 2","visible":true,"transform":{"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]},"kind":"environment","assetId":null}],"outputs":[{"id":"output_main","cameraId":"camera_main","width":1920,"height":1080,"fps":60}]}},
{"name":"asset-null-credits","target":"asset","valid":false,"errorCode":"INVALID_INPUT","payload":{"id":"fixture_glb_1","format":"glb","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":1,"sourceUrl":null,"licenseLabel":"CC0","importerVersion":1,"name":"Fixture","credits":null}},
{"name":"asset-credits-ftp-source","target":"asset","valid":false,"errorCode":"INVALID_INPUT","payload":{"id":"fixture_glb_1","format":"glb","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":1,"sourceUrl":null,"licenseLabel":"CC0","importerVersion":1,"name":"Fixture","credits":{"title":null,"author":null,"license":null,"sourceUrl":"ftp://example.com/room"}}}
```

- [ ] **Step 9: Run all contract tests**

Run: `cargo test -p opensekai-contracts && pnpm vitest run --project unit packages/contracts`
Expected: PASS, including `expanded_shared_vectors` and the TS `shared vector two-environments`, `asset-null-credits`, `asset-credits-ftp-source`.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts crates/contracts fixtures/protocol/validation-vectors.json apps/desktop/src-tauri/src/assets/registry.rs
git commit -m "Add the environment kind, camera flag, and asset credits to the contracts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

---

### Task 2: Session operations

**Files:**
- Modify: `packages/session/src/scene-ops.ts`
- Create: `packages/session/test/environment-patch.test.ts`

**Interfaces:**
- Consumes: the Task 1 `PatchOp` members and `SceneEntity` environment member.
- Produces: `applyOperations` applies `setEnvironmentModel` and `setCameraRenderEnvironment` with the R3/R4 error codes.

- [ ] **Step 1: Write the failing test**

Create `packages/session/test/environment-patch.test.ts`:

```ts
import { it, expect } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const environment = (id: string): SceneEntity => ({ id, name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null });
it('creates an environment and sets, replaces, and clears its model', () => {
    const s = createSession(makeSmokeScene(), 'environment-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: environment('stage') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setEnvironmentModel', entityId: 'stage', assetId: 'scene_a' }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'stage')).toMatchObject({ assetId: 'scene_a' });
    expect(s.applyPatch(patch(2, [{ kind: 'setEnvironmentModel', entityId: 'stage', assetId: null }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'stage')).toMatchObject({ assetId: null });
});
it('rejects a second environment', () => {
    const s = createSession(makeSmokeScene(), 'environment-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: environment('stage') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: environment('stage_2') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
it('rejects setEnvironmentModel on another kind or an unknown entity', () => {
    const s = createSession(makeSmokeScene(), 'environment-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setEnvironmentModel', entityId: 'performer', assetId: 'scene_a' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setEnvironmentModel', entityId: 'nobody', assetId: null }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});
it('sets the Render Environment flag on a camera only', () => {
    const s = createSession(makeSmokeScene(), 'environment-test');
    const camera = s.inspect().entities.find(e => e.kind === 'camera')!;
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraRenderEnvironment', entityId: camera.id, renderEnvironment: false }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === camera.id)).toMatchObject({ renderEnvironment: false });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraRenderEnvironment', entityId: 'performer', renderEnvironment: true }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraRenderEnvironment', entityId: 'nobody', renderEnvironment: true }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project unit packages/session/test/environment-patch.test.ts`
Expected: FAIL on the `setEnvironmentModel` and `setCameraRenderEnvironment` cases (the switch has no branch, so the scene does not change).

- [ ] **Step 3: Implement**

In `packages/session/src/scene-ops.ts`, add two cases after `case 'setAvatarModel'`:

```ts
                 case 'setEnvironmentModel':if(entity.kind!=='environment')return failure('INVALID_INPUT','Entity is not an environment',[entity.id]);entity.assetId=operation.assetId;break;
                 case 'setCameraRenderEnvironment':if(entity.kind!=='camera')return failure('INVALID_INPUT','Entity is not a camera',[entity.id]);entity.renderEnvironment=operation.renderEnvironment;break;
```

- [ ] **Step 4: Run the session tests**

Run: `pnpm vitest run --project unit packages/session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session
git commit -m "Apply environment model and Render Environment operations in the session" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

---

### Task 3: Native scene packer

**Files:**
- Create: `apps/desktop/src-tauri/src/assets/scene_import.rs`
- Modify: `apps/desktop/src-tauri/src/assets/mod.rs`
- Modify: `apps/desktop/src-tauri/src/assets/registry.rs` (make `validate_glb` `pub(super)`; raise `MAX_IMPORT_BYTES`)
- Modify: `Cargo.toml` (workspace deps), `apps/desktop/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: `opensekai_contracts::{invalid, AppError, AssetCredits}`; `registry::{MAX_IMPORT_BYTES, MAX_GLB_JSON_BYTES, validate_glb}`.
- Produces: `pub fn pack_scene(path: &Path, limits: Limits) -> Result<PackedScene, AppError>`; `pub struct Limits { pub max_glb: u64, pub max_json: usize, pub zip_entries: usize, pub zip_bytes: u64 }` with `Limits::DEFAULT`; `pub struct PackedScene { pub glb: Vec<u8>, pub credits: Option<AssetCredits>, pub stem: String }`.

- [ ] **Step 1: Add the dependencies**

In the root `Cargo.toml` `[workspace.dependencies]`, add:

```toml
zip = { version = "=9.0.3", default-features = false, features = ["deflate"] }
percent-encoding = { version = "=2.3.2", features = [] }
```

In `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`, add:

```toml
zip.workspace = true
percent-encoding.workspace = true
url.workspace = true
```

Run: `cargo check -p opensekai-desktop`
Expected: PASS (the lockfile gains `zip`). If the `deflate` feature name differs in zip 9.0.3, read `https://docs.rs/crate/zip/9.0.3/features` and use the feature that enables Deflate decompression with the smallest backend.

In `registry.rs`, change `pub const MAX_IMPORT_BYTES: u64 = 128 * 1024 * 1024;` to `256 * 1024 * 1024`, and `fn validate_glb(` to `pub(super) fn validate_glb(`.

In `assets/mod.rs`:

```rust
mod registry;
mod scene_import;
pub use registry::{resolve_asset, AssetRegistry, ImportResult};
pub use scene_import::{pack_scene, Limits, PackedScene};
```

- [ ] **Step 2: Write the module with its tests first failing**

Create `apps/desktop/src-tauri/src/assets/scene_import.rs` with only the public items as stubs and the full test module. Stub bodies:

```rust
use opensekai_contracts::{invalid, AppError, AssetCredits};
use std::path::Path;
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_glb: u64,
    pub max_json: usize,
    pub zip_entries: usize,
    pub zip_bytes: u64,
}
impl Limits {
    pub const DEFAULT: Self = Self {
        max_glb: super::registry::MAX_IMPORT_BYTES,
        max_json: super::registry::MAX_GLB_JSON_BYTES,
        zip_entries: 4096,
        zip_bytes: 1 << 30,
    };
}
#[derive(Debug)]
pub struct PackedScene {
    pub glb: Vec<u8>,
    pub credits: Option<AssetCredits>,
    pub stem: String,
}
pub fn pack_scene(_path: &Path, _limits: Limits) -> Result<PackedScene, AppError> {
    Err(invalid("not implemented"))
}
```

Append the tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::io::Write;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-png-body";
    fn room(image_uri: &str) -> Value {
        json!({
            "asset": {"version": "2.0", "extras": {
                "title": "Anime stylized room free",
                "author": "CG Lads (https://sketchfab.com/CGlads)",
                "license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)",
                "source": "https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d"}},
            "buffers": [{"uri": "scene.bin", "byteLength": 8}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 8}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 2, "type": "SCALAR"}],
            "images": [{"uri": image_uri}],
            "textures": [{"source": 0}],
            "nodes": [{"name": "root"}]
        })
    }
    fn folder(json: &Value, files: &[(&str, &[u8])]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("scene.gltf"), serde_json::to_vec(json).unwrap()).unwrap();
        std::fs::write(dir.path().join("scene.bin"), [1u8; 8]).unwrap();
        for (name, bytes) in files {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        dir
    }
    fn zip_file(dir: &Path, entries: &[(&str, Vec<u8>)]) -> std::path::PathBuf {
        let path = dir.join("room.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, bytes) in entries {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }
    fn json_of(glb: &[u8]) -> Value {
        split_glb(glb).unwrap().0
    }
    fn has_uri(value: &Value) -> bool {
        match value {
            Value::Object(o) => o.iter().any(|(k, v)| k == "uri" || has_uri(v)),
            Value::Array(a) => a.iter().any(has_uri),
            _ => false,
        }
    }
    fn message(result: Result<PackedScene, AppError>) -> String {
        result.unwrap_err().message
    }
    #[test]
    fn packs_multi_file_gltf() {
        let dir = folder(&room("textures/Room%20color.png"), &[("textures/Room color.png", PNG)]);
        let packed = pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap();
        super::super::registry::validate_glb(&packed.glb).unwrap();
        let json = json_of(&packed.glb);
        assert!(!has_uri(&json));
        assert_eq!(json["buffers"].as_array().unwrap().len(), 1);
        assert_eq!(json["images"][0]["mimeType"], "image/png");
        let view = &json["bufferViews"][json["images"][0]["bufferView"].as_u64().unwrap() as usize];
        assert_eq!(view["byteLength"], PNG.len());
        assert_eq!(view["byteOffset"].as_u64().unwrap() % 4, 0);
        for key in ["accessors", "nodes", "textures"] {
            assert_eq!(json[key].as_array().unwrap().len(), 1, "{key}");
        }
        let credits = packed.credits.unwrap();
        assert_eq!(credits.title.as_deref(), Some("Anime stylized room free"));
        assert_eq!(packed.stem, "scene");
    }
    #[test]
    fn resolves_non_ascii_names() {
        let dir = folder(&room("textures/%E8%89%B2.png"), &[("textures/色.png", PNG)]);
        assert!(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).is_ok());
    }
    #[test]
    fn decodes_data_uris() {
        let mut json = room("data:image/png;base64,iVBORw0KGgpmYWtl");
        json["buffers"][0]["uri"] = json!("data:application/octet-stream;base64,AQEBAQEBAQE=");
        let dir = folder(&json, &[]);
        let packed = pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap();
        assert!(!has_uri(&json_of(&packed.glb)));
    }
    #[test]
    fn packs_glb_with_external_texture() {
        let dir = folder(&room("textures/a.png"), &[("textures/a.png", PNG)]);
        let mut json = room("textures/a.png");
        json["buffers"][0].as_object_mut().unwrap().remove("uri");
        let mut text = serde_json::to_vec(&json).unwrap();
        while text.len() % 4 != 0 { text.push(b' '); }
        let bin = [1u8; 8];
        let mut glb = b"glTF".to_vec();
        glb.extend(2u32.to_le_bytes());
        glb.extend(((12 + 8 + text.len() + 8 + bin.len()) as u32).to_le_bytes());
        glb.extend((text.len() as u32).to_le_bytes());
        glb.extend(0x4e4f534au32.to_le_bytes());
        glb.extend(&text);
        glb.extend((bin.len() as u32).to_le_bytes());
        glb.extend(0x004e4942u32.to_le_bytes());
        glb.extend(bin);
        std::fs::write(dir.path().join("room.glb"), glb).unwrap();
        let packed = pack_scene(&dir.path().join("room.glb"), Limits::DEFAULT).unwrap();
        assert!(!has_uri(&json_of(&packed.glb)));
        assert_eq!(packed.stem, "room");
    }
    #[test]
    fn packs_sketchfab_zip_at_root_and_one_folder_down() {
        let json = serde_json::to_vec(&room("textures/a.png")).unwrap();
        for prefix in ["", "room/"] {
            let dir = tempfile::tempdir().unwrap();
            let zip = zip_file(dir.path(), &[
                (&format!("{prefix}scene.gltf"), json.clone()),
                (&format!("{prefix}scene.bin"), vec![1u8; 8]),
                (&format!("{prefix}textures/a.png"), PNG.to_vec()),
            ]);
            assert!(!has_uri(&json_of(&pack_scene(&zip, Limits::DEFAULT).unwrap().glb)), "{prefix}");
        }
    }
    #[test]
    fn zip_ignores_macos_resource_forks() {
        let json = serde_json::to_vec(&room("textures/a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let zip = zip_file(dir.path(), &[
            ("scene.gltf", json),
            ("__MACOSX/._scene.gltf", b"resource fork".to_vec()),
            ("scene.bin", vec![1u8; 8]),
            ("textures/a.png", PNG.to_vec()),
        ]);
        assert!(pack_scene(&zip, Limits::DEFAULT).is_ok());
    }
    #[test]
    fn rejects_unsafe_or_missing_references() {
        for (uri, expected) in [
            ("../outside.png", "leaves the model folder"),
            ("/etc/passwd", "Unsupported file reference"),
            ("https://example.com/a.png", "Unsupported file reference"),
            ("file:///etc/passwd", "Unsupported file reference"),
            ("missing.png", "Missing file"),
        ] {
            let dir = folder(&room(uri), &[]);
            assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains(expected), "{uri}");
        }
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_outside_the_folder() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.png"), PNG).unwrap();
        let dir = folder(&room("textures/link.png"), &[]);
        std::fs::create_dir_all(dir.path().join("textures")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.png"), dir.path().join("textures/link.png")).unwrap();
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains("leaves the model folder"));
    }
    #[test]
    fn rejects_unsupported_images_and_required_extensions() {
        let dir = folder(&room("a.gif"), &[("a.gif", b"GIF89a....")]);
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains("Unsupported image type"));
        let mut json = room("a.png");
        json["extensionsRequired"] = json!(["KHR_draco_mesh_compression"]);
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT)).contains("KHR_draco_mesh_compression"));
    }
    #[test]
    fn rejects_bad_zip_archives() {
        let json = serde_json::to_vec(&room("a.png")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let two = zip_file(dir.path(), &[("a.gltf", json.clone()), ("b.glb", vec![0; 4])]);
        assert!(message(pack_scene(&two, Limits::DEFAULT)).contains("exactly one"));
        let dir = tempfile::tempdir().unwrap();
        let slip = zip_file(dir.path(), &[("scene.gltf", json.clone()), ("../evil.png", PNG.to_vec())]);
        assert!(message(pack_scene(&slip, Limits::DEFAULT)).contains("leaves the archive"));
        let dir = tempfile::tempdir().unwrap();
        let many = zip_file(dir.path(), &[("scene.gltf", json.clone()), ("scene.bin", vec![1; 8]), ("a.png", PNG.to_vec())]);
        assert!(message(pack_scene(&many, Limits { zip_entries: 2, ..Limits::DEFAULT })).contains("too many files"));
        assert!(message(pack_scene(&many, Limits { zip_bytes: 16, ..Limits::DEFAULT })).contains("too large"));
    }
    #[test]
    fn rejects_output_over_budget() {
        let dir = folder(&room("a.png"), &[("a.png", PNG)]);
        assert!(message(pack_scene(&dir.path().join("scene.gltf"), Limits { max_glb: 64, ..Limits::DEFAULT })).contains("exceeds import budget"));
    }
    #[test]
    fn strips_file_lights() {
        let mut json = room("a.png");
        json["extensionsUsed"] = json!(["KHR_lights_punctual", "KHR_materials_specular"]);
        json["extensions"] = json!({"KHR_lights_punctual": {"lights": [{"type": "point"}]}});
        json["nodes"][0]["extensions"] = json!({"KHR_lights_punctual": {"light": 0}});
        let dir = folder(&json, &[("a.png", PNG)]);
        let out = json_of(&pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap().glb);
        assert_eq!(out["extensionsUsed"], json!(["KHR_materials_specular"]));
        assert!(out["extensions"].get("KHR_lights_punctual").is_none());
        assert!(out["nodes"][0]["extensions"].get("KHR_lights_punctual").is_none());
    }
    #[test]
    fn bounds_credits() {
        let mut json = room("a.png");
        json["asset"]["extras"] = json!({"title": "  ", "author": 7, "license": "x".repeat(513), "source": "javascript:alert(1)"});
        let dir = folder(&json, &[("a.png", PNG)]);
        assert!(pack_scene(&dir.path().join("scene.gltf"), Limits::DEFAULT).unwrap().credits.is_none());
    }
}
```

Run: `cargo test -p opensekai-desktop --lib scene_import`
Expected: FAIL (compile error `split_glb` not found, then failures from the stub).

If `ZipWriter::start_file` in zip 9.0.3 refuses the name `../evil.png`, write the entry as `xx/evil.png` and then replace every `xx/evil.png` byte sequence in the finished archive with `../evil.png` (same length, so the local header and the central directory stay valid).

- [ ] **Step 3: Implement the packer**

Replace the stub `pack_scene` and add the implementation items above the test module:

```rust
use base64::{engine::general_purpose::STANDARD, Engine};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

const JSON_CHUNK: u32 = 0x4e4f534a;
const BIN_CHUNK: u32 = 0x004e4942;
const LIGHTS: &str = "KHR_lights_punctual";
// Extensions that three.js GLTFLoader handles without an extra decoder in this renderer.
const SUPPORTED_REQUIRED: &[&str] = &[
    "KHR_materials_anisotropy",
    "KHR_materials_clearcoat",
    "KHR_materials_dispersion",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_iridescence",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_unlit",
    "KHR_materials_volume",
    "KHR_mesh_quantization",
    "KHR_texture_transform",
    "KHR_lights_punctual",
    "EXT_texture_webp",
    "EXT_mesh_gpu_instancing",
];

fn named(message: &str, reference: &str) -> AppError {
    invalid(format!("{message}: {}", reference.chars().take(120).collect::<String>()))
}

trait SceneSource {
    fn read(&mut self, relative: &str) -> Result<Vec<u8>, AppError>;
}

fn normalize(relative: &str) -> Result<String, AppError> {
    if relative.is_empty() || relative.starts_with('/') || relative.contains('\\') || relative.contains('\0') {
        return Err(named("Unsupported file reference", relative));
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(named("File reference leaves the model folder", relative));
                }
            }
            part => parts.push(part),
        }
    }
    if parts.is_empty() {
        return Err(named("Unsupported file reference", relative));
    }
    Ok(parts.join("/"))
}

fn read_bounded(reader: impl Read, max: u64) -> Result<Vec<u8>, AppError> {
    let mut bytes = Vec::new();
    reader
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid("File unavailable"))?;
    if bytes.len() as u64 > max {
        return Err(invalid("Scene exceeds import budget"));
    }
    Ok(bytes)
}

struct FolderSource {
    root: PathBuf,
    max: u64,
}
impl SceneSource for FolderSource {
    fn read(&mut self, relative: &str) -> Result<Vec<u8>, AppError> {
        let relative = normalize(relative)?;
        let path = self
            .root
            .join(&relative)
            .canonicalize()
            .map_err(|_| named("Missing file", &relative))?;
        if !path.starts_with(&self.root) {
            return Err(named("File reference leaves the model folder", &relative));
        }
        if !path.is_file() {
            return Err(named("Missing file", &relative));
        }
        let file = std::fs::File::open(&path).map_err(|_| named("Missing file", &relative))?;
        read_bounded(file, self.max)
    }
}

struct ZipSource {
    archive: zip::ZipArchive<std::fs::File>,
    base: String,
    max: u64,
}
impl ZipSource {
    fn open(path: &Path, limits: Limits) -> Result<(Self, String), AppError> {
        let file = std::fs::File::open(path).map_err(|_| invalid("Archive unavailable"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|_| invalid("Invalid zip archive"))?;
        if archive.len() > limits.zip_entries {
            return Err(invalid("Archive has too many files"));
        }
        let mut total = 0u64;
        let mut roots = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index_raw(index).map_err(|_| invalid("Invalid zip archive"))?;
            if entry.enclosed_name().is_none() {
                return Err(named("Archive entry leaves the archive", entry.name()));
            }
            total = total.saturating_add(entry.size());
            if total > limits.zip_bytes {
                return Err(invalid("Archive is too large"));
            }
            let name = entry.name().to_string();
            let lower = name.to_ascii_lowercase();
            if !entry.is_dir()
                && !lower.starts_with("__macosx/")
                && name.matches('/').count() <= 1
                && (lower.ends_with(".gltf") || lower.ends_with(".glb"))
            {
                roots.push(name);
            }
        }
        let [root] = roots.as_slice() else {
            return Err(invalid("Archive must hold exactly one .gltf or .glb file"));
        };
        let root = root.clone();
        let base = root
            .rsplit_once('/')
            .map(|(folder, _)| format!("{folder}/"))
            .unwrap_or_default();
        Ok((Self { archive, base, max: limits.max_glb }, root))
    }
    fn entry(&mut self, name: &str) -> Result<Vec<u8>, AppError> {
        let max = self.max;
        let entry = self.archive.by_name(name).map_err(|_| named("Missing file", name))?;
        read_bounded(entry, max)
    }
}
impl SceneSource for ZipSource {
    fn read(&mut self, relative: &str) -> Result<Vec<u8>, AppError> {
        let relative = normalize(relative)?;
        let name = format!("{}{relative}", self.base);
        self.entry(&name).map_err(|_| named("Missing file", &relative))
    }
}

pub fn pack_scene(path: &Path, limits: Limits) -> Result<PackedScene, AppError> {
    let extension = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let stem = |name: &Path| name.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    match extension.as_deref() {
        Some("zip") => {
            let (mut source, root) = ZipSource::open(path, limits)?;
            let bytes = source.entry(&root)?;
            let binary = root.to_ascii_lowercase().ends_with(".glb");
            pack_root(&bytes, binary, &mut source, limits, stem(Path::new(&root)))
        }
        Some(kind @ ("glb" | "gltf")) => {
            let folder = path.parent().ok_or_else(|| invalid("Model folder unavailable"))?;
            let root = folder.canonicalize().map_err(|_| invalid("Model folder unavailable"))?;
            let max = if kind == "glb" { limits.max_glb } else { limits.max_json as u64 };
            let file = std::fs::File::open(path).map_err(|_| invalid("File unavailable"))?;
            let bytes = read_bounded(file, max)?;
            let mut source = FolderSource { root, max: limits.max_glb };
            pack_root(&bytes, kind == "glb", &mut source, limits, stem(path))
        }
        _ => Err(invalid("Choose a .glb, .gltf, or .zip file")),
    }
}

fn pack_root(
    bytes: &[u8],
    binary: bool,
    source: &mut dyn SceneSource,
    limits: Limits,
    stem: String,
) -> Result<PackedScene, AppError> {
    let (json, bin) = if binary {
        split_glb(bytes)?
    } else {
        (serde_json::from_slice(bytes).map_err(|_| invalid("Invalid glTF JSON"))?, None)
    };
    let credits = read_credits(&json);
    let glb = pack(json, bin, source, limits)?;
    Ok(PackedScene { glb, credits, stem })
}

fn split_glb(bytes: &[u8]) -> Result<(Value, Option<Vec<u8>>), AppError> {
    let word = |offset: usize| -> Result<u32, AppError> {
        bytes
            .get(offset..offset + 4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .ok_or_else(|| invalid("Truncated GLB"))
    };
    if bytes.get(..4) != Some(b"glTF") || word(4)? != 2 || word(8)? as usize != bytes.len() {
        return Err(invalid("Invalid GLB header"));
    }
    if word(16)? != JSON_CHUNK {
        return Err(invalid("Invalid GLB JSON"));
    }
    let json_end = 20usize
        .checked_add(word(12)? as usize)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| invalid("Invalid GLB JSON"))?;
    let json = serde_json::from_slice(&bytes[20..json_end]).map_err(|_| invalid("Invalid GLB JSON"))?;
    let bin = if json_end + 8 <= bytes.len() {
        if word(json_end + 4)? != BIN_CHUNK {
            return Err(invalid("Invalid GLB chunks"));
        }
        let start = json_end + 8;
        let end = start
            .checked_add(word(json_end)? as usize)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid("Invalid GLB chunks"))?;
        Some(bytes[start..end].to_vec())
    } else {
        None
    };
    Ok((json, bin))
}

fn resolve(uri: &str, source: &mut dyn SceneSource) -> Result<Vec<u8>, AppError> {
    if let Some(rest) = uri.strip_prefix("data:") {
        let (_, payload) = rest
            .split_once(";base64,")
            .ok_or_else(|| named("Unsupported data URI", "data:"))?;
        return STANDARD.decode(payload).map_err(|_| named("Invalid data URI", "data:"));
    }
    if let Some(colon) = uri.find(':') {
        if !uri[..colon].contains('/') {
            return Err(named("Unsupported file reference", uri));
        }
    }
    let decoded = percent_decode_str(uri)
        .decode_utf8()
        .map_err(|_| named("Invalid file reference", uri))?;
    source.read(&decoded)
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn append(bin: &mut Vec<u8>, data: &[u8]) -> usize {
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let offset = bin.len();
    bin.extend_from_slice(data);
    offset
}

fn pack(
    mut json: Value,
    glb_bin: Option<Vec<u8>>,
    source: &mut dyn SceneSource,
    limits: Limits,
) -> Result<Vec<u8>, AppError> {
    if !json.is_object() || json.pointer("/asset/version").and_then(Value::as_str) != Some("2.0") {
        return Err(invalid("Unsupported glTF version"));
    }
    for name in json.get("extensionsRequired").and_then(Value::as_array).into_iter().flatten() {
        let name = name.as_str().unwrap_or("");
        if !SUPPORTED_REQUIRED.contains(&name) {
            return Err(named("Unsupported required extension", name));
        }
    }
    let mut glb_bin = glb_bin;
    let mut sources = Vec::new();
    for (index, buffer) in json.get("buffers").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let bytes = match buffer.get("uri").and_then(Value::as_str) {
            Some(uri) => resolve(uri, source)?,
            None if index == 0 => glb_bin.take().ok_or_else(|| invalid("Missing GLB binary chunk"))?,
            None => return Err(invalid("Buffer has no data")),
        };
        let length = buffer
            .get("byteLength")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("Invalid buffer length"))?;
        if (bytes.len() as u64) < length {
            return Err(invalid("Buffer is shorter than its byteLength"));
        }
        sources.push(bytes);
    }
    let mut bin = Vec::new();
    for view in json.get_mut("bufferViews").and_then(Value::as_array_mut).into_iter().flatten() {
        let buffer = view.get("buffer").and_then(Value::as_u64).ok_or_else(|| invalid("Invalid buffer view"))? as usize;
        let offset = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
        let length = view.get("byteLength").and_then(Value::as_u64).ok_or_else(|| invalid("Invalid buffer view"))? as usize;
        let data = sources
            .get(buffer)
            .and_then(|b| b.get(offset..offset.checked_add(length)?))
            .ok_or_else(|| invalid("Buffer view outside its buffer"))?;
        let at = append(&mut bin, data);
        view["buffer"] = json!(0);
        view["byteOffset"] = json!(at);
    }
    drop(sources);
    let mut views: Vec<Value> = json.get("bufferViews").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut images: Vec<Value> = json.get("images").and_then(Value::as_array).cloned().unwrap_or_default();
    for image in &mut images {
        let object = image.as_object_mut().ok_or_else(|| invalid("Invalid image"))?;
        if let Some(uri) = object.get("uri").and_then(Value::as_str).map(str::to_owned) {
            let bytes = resolve(&uri, source)?;
            let mime = image_mime(&bytes).ok_or_else(|| named("Unsupported image type", &uri))?;
            let at = append(&mut bin, &bytes);
            views.push(json!({"buffer": 0, "byteOffset": at, "byteLength": bytes.len()}));
            object.remove("uri");
            object.insert("bufferView".into(), json!(views.len() - 1));
            object.insert("mimeType".into(), json!(mime));
        } else {
            let view = object
                .get("bufferView")
                .and_then(Value::as_u64)
                .and_then(|index| views.get(index as usize))
                .ok_or_else(|| invalid("Image has no data"))?;
            let start = view["byteOffset"].as_u64().unwrap_or(0) as usize;
            let end = start + view["byteLength"].as_u64().unwrap_or(0) as usize;
            let mime = bin.get(start..end).and_then(image_mime).ok_or_else(|| invalid("Unsupported image type"))?;
            object.insert("mimeType".into(), json!(mime));
        }
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let root = json.as_object_mut().expect("checked object");
    if !views.is_empty() {
        root.insert("bufferViews".into(), Value::Array(views));
    }
    if !images.is_empty() {
        root.insert("images".into(), Value::Array(images));
    }
    if bin.is_empty() {
        root.remove("buffers");
    } else {
        root.insert("buffers".into(), json!([{"byteLength": bin.len()}]));
    }
    strip_lights(&mut json);
    let mut text = serde_json::to_vec(&json).map_err(|_| invalid("Invalid glTF JSON"))?;
    while text.len() % 4 != 0 {
        text.push(b' ');
    }
    if text.len() > limits.max_json {
        return Err(invalid("GLB JSON exceeds budget"));
    }
    let total = 20 + text.len() + if bin.is_empty() { 0 } else { 8 + bin.len() };
    if total as u64 > limits.max_glb {
        return Err(invalid("Scene exceeds import budget"));
    }
    let mut glb = Vec::with_capacity(total);
    glb.extend_from_slice(b"glTF");
    glb.extend(2u32.to_le_bytes());
    glb.extend((total as u32).to_le_bytes());
    glb.extend((text.len() as u32).to_le_bytes());
    glb.extend(JSON_CHUNK.to_le_bytes());
    glb.extend(text);
    if !bin.is_empty() {
        glb.extend((bin.len() as u32).to_le_bytes());
        glb.extend(BIN_CHUNK.to_le_bytes());
        glb.extend(bin);
    }
    Ok(glb)
}

fn strip_lights(json: &mut Value) {
    if let Some(extensions) = json.get_mut("extensions").and_then(Value::as_object_mut) {
        extensions.remove(LIGHTS);
    }
    for node in json.get_mut("nodes").and_then(Value::as_array_mut).into_iter().flatten() {
        if let Some(extensions) = node.get_mut("extensions").and_then(Value::as_object_mut) {
            extensions.remove(LIGHTS);
        }
    }
    for key in ["extensionsUsed", "extensionsRequired"] {
        if let Some(list) = json.get_mut(key).and_then(Value::as_array_mut) {
            list.retain(|value| value.as_str() != Some(LIGHTS));
        }
    }
}

fn read_credits(json: &Value) -> Option<AssetCredits> {
    let text = |key: &str| {
        json.pointer(&format!("/asset/extras/{key}"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty() && s.encode_utf16().count() <= 512)
            .map(str::to_owned)
    };
    let source_url = text("source").filter(|s| {
        url::Url::parse(s).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
    });
    let credits = AssetCredits {
        title: text("title"),
        author: text("author"),
        license: text("license"),
        source_url,
    };
    (credits.title.is_some()
        || credits.author.is_some()
        || credits.license.is_some()
        || credits.source_url.is_some())
    .then_some(credits)
}
```

If `zip` 9.0.3 names `by_index_raw`, `enclosed_name`, `size`, `is_dir`, or `SimpleFileOptions` differently, read `https://docs.rs/zip/9.0.3/zip/` and use the equivalent; do not change the behavior.

- [ ] **Step 4: Run the packer tests**

Run: `cargo test -p opensekai-desktop --lib scene_import`
Expected: PASS for all 13 tests (12 on a non-Unix host).

- [ ] **Step 5: Run the full desktop Rust suite and clippy**

Run: `cargo test -p opensekai-desktop && cargo clippy -p opensekai-desktop --all-targets -- -D warnings`
Expected: PASS. The `scene_import` items other than `pack_scene`, `Limits`, and `PackedScene` are private; clippy may flag unused items until Task 4 uses `pack_scene`. If so, add `#[allow(dead_code)]` only on the `pub use` line in `mod.rs` and remove it in Task 4.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/src/assets
git commit -m "Pack multi-file glTF, GLB, and zip scenes into one self-contained GLB" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

---

### Task 4: Registry storage, the `import_scene` command, and the integration test

**Files:**
- Modify: `apps/desktop/src-tauri/src/assets/registry.rs` (`store_scene`, `load_library`, `fixture_records`)
- Modify: `apps/desktop/src-tauri/src/service/mod.rs` (`ServicePorts::import_scene`, `ServiceHandle::import_scene`)
- Modify: `apps/desktop/src-tauri/src/bootstrap.rs` (`DesktopState::import_scene`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (command and `generate_handler`)
- Modify: `apps/desktop/src-tauri/build.rs`, `apps/desktop/src-tauri/capabilities/editor.json`
- Test: `apps/desktop/src-tauri/tests/import_integration.rs`, registry unit tests in `registry.rs`

**Interfaces:**
- Consumes: `pack_scene(path, Limits::DEFAULT) -> Result<PackedScene, AppError>` (Task 3).
- Produces: `AssetRegistry::store_scene(&mut self, packed: PackedScene) -> Result<ImportResult, AppError>`; `ServiceHandle::import_scene(&self, path: PathBuf) -> Result<ImportResult, AppError>`; Tauri command `import_scene` returning `Option<ImportResult>` (`{ record, name }`) to the editor window only.

- [ ] **Step 1: Write the failing registry tests**

Add to the `boundary_tests` module in `registry.rs`:

```rust
    fn packed(title: Option<&str>, glb: Vec<u8>) -> super::super::PackedScene {
        super::super::PackedScene {
            glb,
            credits: title.map(|t| opensekai_contracts::AssetCredits {
                title: Some(t.into()),
                author: Some("CG Lads".into()),
                license: Some("CC-BY-4.0".into()),
                source_url: Some("https://sketchfab.com/3d-models/room".into()),
            }),
            stem: "scene".into(),
        }
    }
    #[test]
    fn stores_scene_with_credits_and_reloads_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let result = registry.store_scene(packed(Some("Room"), glb())).unwrap();
        let record = &result.record;
        assert!(record.id.starts_with("scene_"));
        assert_eq!(record.format, opensekai_contracts::AssetFormat::Glb);
        assert_eq!(record.name, "Room");
        assert_eq!(record.license_label, "CC-BY-4.0");
        assert_eq!(record.source_url.as_deref(), Some("https://sketchfab.com/3d-models/room"));
        assert_eq!(registry.read(&record.id).unwrap(), glb());
        let reopened = AssetRegistry::empty(dir.path()).unwrap();
        assert_eq!(reopened.records(), vec![record.clone()]);
        assert_eq!(reopened.read(&record.id).unwrap(), glb());
    }
    #[test]
    fn same_scene_returns_the_existing_record() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let first = registry.store_scene(packed(Some("Room"), glb())).unwrap();
        let second = registry.store_scene(packed(Some("Other"), glb())).unwrap();
        assert_eq!(first.record, second.record);
        assert_eq!(registry.records().len(), 1);
    }
    #[test]
    fn scene_name_falls_back_to_stem_then_scene() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AssetRegistry::empty(dir.path()).unwrap();
        let long = "x".repeat(129);
        assert_eq!(registry.store_scene(packed(Some(&long), glb())).unwrap().record.name, "scene");
        let mut other = glb();
        other.extend([b' '; 4]);
        let len = other.len() as u32;
        other[8..12].copy_from_slice(&len.to_le_bytes());
        other[12..16].copy_from_slice(&(len - 20).to_le_bytes());
        let mut nameless = packed(None, other);
        nameless.stem = "   ".into();
        let record = registry.store_scene(nameless).unwrap().record;
        assert_eq!(record.name, "Scene");
        assert!(record.credits.is_none());
        assert_eq!(record.license_label, "");
    }
```

Run: `cargo test -p opensekai-desktop --lib boundary_tests`
Expected: FAIL (`store_scene` not found).

- [ ] **Step 2: Implement `store_scene` and the library load**

In `registry.rs`, add `use super::scene_import::PackedScene;` and `use opensekai_contracts::AssetFormat;` at the top. Add helpers below `bounded_name`:

```rust
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), AppError> {
    let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.write_all(bytes).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.as_file().sync_all().map_err(|_| error(ErrorCode::Unavailable, ""))?;
    temp.persist(dir.join(name)).map_err(|_| error(ErrorCode::Unavailable, ""))?;
    Ok(())
}
```

Add to `impl AssetRegistry`:

```rust
    pub fn store_scene(&mut self, packed: PackedScene) -> Result<ImportResult, AppError> {
        let sha256 = hex(&Sha256::digest(&packed.glb));
        let id = format!("scene_{sha256}");
        if let Some(entry) = self.entries.get(&id) {
            return Ok(ImportResult { name: entry.record.name.clone(), record: entry.record.clone() });
        }
        let credits = packed.credits;
        let name = credits
            .as_ref()
            .and_then(|c| c.title.as_deref())
            .filter(|t| t.encode_utf16().count() <= 128)
            .and_then(bounded_name)
            .or_else(|| bounded_name(&packed.stem))
            .unwrap_or_else(|| "Scene".into());
        let record = AssetRecord {
            id: id.clone(),
            format: AssetFormat::Glb,
            sha256,
            bytes: packed.glb.len() as u64,
            source_url: credits.as_ref().and_then(|c| c.source_url.clone()),
            license_label: credits.as_ref().and_then(|c| c.license.clone()).unwrap_or_default(),
            importer_version: 1,
            name: name.clone(),
            credits,
        };
        record.validate()?;
        let library = self.library.clone();
        std::fs::create_dir_all(&library).map_err(|_| error(ErrorCode::Unavailable, ""))?;
        write_atomic(&library, &format!("{id}.glb"), &packed.glb)?;
        write_atomic(
            &library,
            &format!("{id}.json"),
            &serde_json::to_vec(&record).map_err(|_| invalid("Invalid scene record"))?,
        )?;
        self.entries.insert(id.clone(), Entry { path: library.join(format!("{id}.glb")), record: record.clone() });
        Ok(ImportResult { record, name })
    }
```

In `load_library`, replace the block from `if record.validate().is_ok()` to the end of its `self.entries.insert(...)` with:

```rust
                let extension = if record.format == AssetFormat::Vrm && record.id == format!("avatar_{}", record.sha256) {
                    Some("vrm")
                } else if record.format == AssetFormat::Glb && record.id == format!("scene_{}", record.sha256) {
                    Some("glb")
                } else {
                    None
                };
                if let (true, true, Some(extension)) = (record.validate().is_ok(), opaque(&record.id), extension) {
                    if backfilled {
                        if let Ok(bytes) = serde_json::to_vec(&record) {
                            if let Ok(mut temp) = tempfile::NamedTempFile::new_in(&library) {
                                let _ = temp.write_all(&bytes).and_then(|_| temp.as_file().sync_all());
                                let _ = temp.persist(&p);
                            }
                        }
                    }
                    self.entries.insert(
                        record.id.clone(),
                        Entry { path: library.join(format!("{}.{extension}", record.id)), record },
                    );
                }
```

In `fixture_records`, change the filter to `.filter(|r| !r.id.starts_with("avatar_") && !r.id.starts_with("scene_"))`.

Run: `cargo test -p opensekai-desktop --lib`
Expected: PASS, including the existing avatar library tests.

- [ ] **Step 3: Write the failing integration test**

Append to `apps/desktop/src-tauri/tests/import_integration.rs`:

```rust
fn glb_json(bytes: &[u8]) -> serde_json::Value {
    let size = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    serde_json::from_slice(&bytes[20..20 + size]).unwrap()
}
// Real folder, packer, managed library, and authenticated HTTP boundaries: the served scene has no external URI.
#[tokio::test]
async fn imported_scene_folder_is_packed_served_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let room = dir.path().join("room");
    std::fs::create_dir_all(room.join("textures")).unwrap();
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().unwrap().write_image_data(&[200, 120, 80, 255]).unwrap();
    }
    std::fs::write(room.join("textures/base color.png"), &png_bytes).unwrap();
    std::fs::write(room.join("scene.bin"), [0u8; 12]).unwrap();
    std::fs::write(room.join("scene.gltf"), serde_json::to_vec(&serde_json::json!({
        "asset": {"version": "2.0", "extras": {"title": "Test room", "license": "CC0"}},
        "buffers": [{"uri": "scene.bin", "byteLength": 12}],
        "bufferViews": [{"buffer": 0, "byteLength": 12}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3", "min": [0, 0, 0], "max": [0, 0, 0]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "images": [{"uri": "textures/base%20color.png"}],
        "textures": [{"source": 0}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0
    })).unwrap()).unwrap();
    let config = || ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: Default::default(),
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: false,
    };
    let service = start_service(config()).await.unwrap();
    let imported = service.import_scene(room.join("scene.gltf")).await.unwrap();
    assert!(imported.record.id.starts_with("scene_"));
    assert_eq!(imported.record.name, "Test room");
    let descriptor = service.operator_descriptor();
    let url = format!("{}/assets/{}", descriptor.http_origin, imported.record.id);
    let served = reqwest::Client::new().get(&url).bearer_auth(descriptor.token).send().await.unwrap().bytes().await.unwrap();
    let json = glb_json(&served);
    assert!(!serde_json::to_string(&json).unwrap().contains("\"uri\""));
    assert_eq!(json["images"][0]["mimeType"], "image/png");
    assert!(json["images"][0]["bufferView"].is_u64());
    service.shutdown().await.unwrap();
    let restarted = start_service(config()).await.unwrap();
    assert!(restarted.asset_records().contains(&imported.record));
    restarted.shutdown().await.unwrap();
}
```

Run: `cargo test -p opensekai-desktop --test import_integration`
Expected: FAIL (`import_scene` not found on the service handle).

- [ ] **Step 4: Implement the service, state, and command**

In `service/mod.rs`, add to `impl ServicePorts` next to `import_avatar`:

```rust
    pub async fn import_scene(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        let shared = self.shared.clone();
        // Pack outside the registry lock so that asset reads continue during a long import.
        tokio::task::spawn_blocking(move || {
            let packed = crate::assets::pack_scene(&path, crate::assets::Limits::DEFAULT)?;
            lock(&shared.registry).store_scene(packed)
        })
        .await
        .map_err(|_| err(ErrorCode::Unavailable, "Scene import failed"))?
    }
```

Add to `impl ServiceHandle` next to its `import_avatar`:

```rust
    pub async fn import_scene(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        self.ports().import_scene(path).await
    }
```

In `bootstrap.rs`, add next to `import_avatar`:

```rust
    pub async fn import_scene(
        &self,
        path: PathBuf,
    ) -> Result<crate::assets::ImportResult, AppError> {
        let owned = self.owned.lock().await;
        let service = owned
            .service
            .as_ref()
            .ok_or_else(|| error(ErrorCode::Unavailable, "Session unavailable"))?;
        service.import_scene(path).await
    }
```

In `lib.rs`, add after the `import_avatar` command:

```rust
#[tauri::command]
async fn import_scene(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<DesktopState>>,
) -> Result<Option<crate::assets::ImportResult>, AppError> {
    require_window_label(window.label(), "editor")?;
    let app = window.app_handle().clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title("Import environment");
        // macOS can disable custom extensions through rfd's deprecated file-type filter.
        #[cfg(not(target_os = "macos"))]
        let dialog = dialog.add_filter("Environment", &["glb", "gltf", "zip"]);
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|_| AppError {
        code: ErrorCode::Unavailable,
        message: "File chooser unavailable".into(),
        ids: vec![],
    })?;
    let Some(path) = path else { return Ok(None) };
    let path = path.into_path().map_err(|_| AppError {
        code: ErrorCode::InvalidInput,
        message: "Local file required".into(),
        ids: vec![],
    })?;
    state.import_scene(path).await.map(Some)
}
```

Add `import_scene` to the `generate_handler![...]` list in `lib.rs` after `import_avatar`, to the command list in `build.rs` after `"import_avatar",`, and `"allow-import-scene"` to `capabilities/editor.json` after `"allow-import-avatar"`. The build generates `permissions/autogenerated/import_scene.toml`; commit it.

- [ ] **Step 5: Run the native suites**

Run: `cargo test -p opensekai-desktop && cargo clippy -p opensekai-desktop --all-targets -- -D warnings`
Expected: PASS, including `imported_scene_folder_is_packed_served_and_survives_restart` and the existing `imported_avatar_is_served_by_opaque_id_and_survives_service_restart`. Remove any temporary `#[allow(dead_code)]` from Task 3.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "Store packed scenes in the library and add the editor import_scene command" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

---

### Task 5: Renderer environment, lighting, Render Environment, and pick filter

**Files:**
- Create: `packages/renderer/src/environment-light.ts`
- Modify: `packages/renderer/src/renderer.ts`
- Modify: `packages/renderer/src/load-jobs.ts:4` (LoadRequest kind)
- Modify: `packages/renderer/src/editor-viewport.ts` (`pickRoots`)
- Create: `packages/renderer/test/environment.test.ts`
- Modify: `packages/renderer/test/editor-viewport.test.ts`

**Interfaces:**
- Consumes: Task 1 `SceneEntity` environment member and camera `renderEnvironment`.
- Produces: `createEnvironmentLight(makeMap: () => { texture: Texture; dispose(): void }): EnvironmentLight` with `apply(root: Object3D): void` and `dispose(): void`; `roomEnvironmentMap(renderer: WebGPURenderer)`; `LoadRequest.kind: 'avatar' | 'mesh' | 'environment'`; `pickRoots(objects)` exported from `editor-viewport.ts`.

- [ ] **Step 1: Write the failing renderer tests**

Create `packages/renderer/test/environment.test.ts`:

```ts
import { it, expect, vi, beforeEach } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, Texture, type Object3D } from 'three/webgpu';
import { makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), compile: vi.fn(), light: { apply: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: ports.render, compileAsync: ports.compile, dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), createEnvironmentLight: () => ports.light, roomEnvironmentMap: () => () => ({ texture: new Texture(), dispose() {} }) }));
import { createRenderer } from '../src/renderer';
const settle = () => new Promise(r => setTimeout(r, 0));
let sequence = 0;
const stage = (assetId: string | null): SceneEntity => ({ id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId });
function frame(options: { assetId?: string | null; flag?: boolean } = {}): RuntimeFrame {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), stage(options.assetId === undefined ? 'scene_a' : options.assetId)];
    const cameraId = f.scene.outputs.find(o => o.id === 'output_main')!.cameraId;
    for (const e of f.scene.entities) if (e.kind === 'camera' && e.id === cameraId && options.flag !== undefined) e.renderEnvironment = options.flag;
    return f;
}
const rendered = () => ports.render.mock.lastCall![0] as Group;
const room = () => { const root = new Group(); root.name = 'room'; return { scene: root, warnings: [], dispose: vi.fn() }; };
beforeEach(() => { ports.load.mockReset(); ports.render.mockReset().mockResolvedValue(undefined); ports.compile.mockReset().mockResolvedValue(undefined); ports.light.apply.mockReset(); ports.light.dispose.mockReset(); });
const make = (outputId: 'output_main' | 'preview_main' = 'output_main') => createRenderer({ canvas: { width: 1920, height: 1080 } as HTMLCanvasElement, outputId, mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, resolutionScale: 1 });

it('loads the environment, lights it before GPU preparation, and draws it', async () => {
    ports.load.mockResolvedValue(room());
    const r = await make();
    await r.applyFrame(frame()); await settle();
    await r.applyFrame(frame());
    const object = rendered().getObjectByName('room');
    expect(object?.visible).toBe(true);
    expect(ports.light.apply).toHaveBeenCalledTimes(1);
    expect((ports.light.apply.mock.calls[0]![0] as Object3D).name).toBe('room');
    expect(ports.light.apply.mock.invocationCallOrder[0]!).toBeLessThan(ports.compile.mock.invocationCallOrder[0]!);
    r.dispose();
});
it('draws nothing for an environment without a model', async () => {
    const r = await make();
    await r.applyFrame(frame({ assetId: null }));
    expect(ports.load).not.toHaveBeenCalled();
    r.dispose();
});
it('hides the environment when the output camera turns Render Environment off', async () => {
    ports.load.mockResolvedValue(room());
    const r = await make();
    await r.applyFrame(frame()); await settle();
    await r.applyFrame(frame({ flag: false }));
    expect(rendered().getObjectByName('room')?.visible).toBe(false);
    await r.applyFrame(frame({ flag: true }));
    expect(rendered().getObjectByName('room')?.visible).toBe(true);
    r.dispose();
});
it('follows the flag of its own output camera', async () => {
    ports.load.mockResolvedValue(room());
    // The smoke frame points both outputs at camera_wide; move the preview to camera_close and turn the flag off there only.
    const split = () => {
        const f = frame();
        f.scene.outputs.find(o => o.id === 'preview_main')!.cameraId = 'camera_close';
        for (const e of f.scene.entities) if (e.kind === 'camera' && e.id === 'camera_close') e.renderEnvironment = false;
        return f;
    };
    for (const [outputId, visible] of [['output_main', true], ['preview_main', false]] as const) {
        const r = await make(outputId);
        await r.applyFrame(split()); await settle();
        await r.applyFrame(split());
        expect(rendered().getObjectByName('room')?.visible).toBe(visible);
        r.dispose();
    }
});
it('sets the map on environment materials only and releases it once', async () => {
    const { createEnvironmentLight } = await vi.importActual<typeof import('../src/environment-light')>('../src/environment-light');
    const dispose = vi.fn();
    const make = vi.fn(() => ({ texture: new Texture(), dispose }));
    const light = createEnvironmentLight(make);
    const material = new MeshStandardMaterial();
    const root = new Group(); root.add(new Mesh(new BoxGeometry(), material));
    const other = new MeshStandardMaterial();
    light.apply(root); light.apply(root);
    expect(material.envMap).toBeInstanceOf(Texture);
    expect(other.envMap).toBeNull();
    expect(make).toHaveBeenCalledTimes(1);
    light.dispose(); light.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
});
```

The last test loads the real `createEnvironmentLight` with `vi.importActual`, because the module mock above replaces it for `renderer.ts` and for the test file.

Add to `packages/renderer/test/editor-viewport.test.ts` (and add `pickRoots` to its import from `../src/editor-viewport`):

```ts
it('does not pick environment roots',()=>{const avatar=new Object3D(),stage=new Object3D(),hidden=new Object3D();hidden.visible=false;expect(pickRoots(new Map([['avatar',{root:avatar}],['stage',{root:stage,pickable:false}],['hidden',{root:hidden}]])).map(([id])=>id)).toEqual(['avatar']);});
```

Run: `pnpm vitest run --project unit packages/renderer/test/environment.test.ts packages/renderer/test/editor-viewport.test.ts`
Expected: FAIL (`../src/environment-light` missing, `pickRoots` missing).

- [ ] **Step 2: Implement the environment light**

Create `packages/renderer/src/environment-light.ts`:

```ts
import { PMREMGenerator, type Material, type Object3D, type Texture, type WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export interface EnvironmentMap { texture: Texture; dispose(): void }
export interface EnvironmentLight { apply(root: Object3D): void; dispose(): void }
// Lights only environment materials; scene.environment stays null so avatar materials keep their look.
export function createEnvironmentLight(makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    return {
        apply(root) {
            map ??= makeMap();
            const texture = map.texture;
            root.traverse(object => {
                const material = (object as { material?: Material | Material[] }).material;
                for (const item of Array.isArray(material) ? material : material ? [material] : [])
                    if ('envMap' in item) { (item as Material & { envMap: Texture | null }).envMap = texture; item.needsUpdate = true; }
            });
        },
        dispose() { map?.dispose(); map = null; }
    };
}
export function roomEnvironmentMap(renderer: WebGPURenderer): () => EnvironmentMap {
    return () => {
        const generator = new PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        try {
            const target = generator.fromScene(room, 0.04);
            return { texture: target.texture, dispose: () => target.dispose() };
        } finally { room.dispose(); generator.dispose(); }
    };
}
```

- [ ] **Step 3: Wire the renderer**

In `packages/renderer/src/load-jobs.ts:4`, change `kind: 'avatar' | 'mesh'` to `kind: 'avatar' | 'mesh' | 'environment'`.

In `packages/renderer/src/editor-viewport.ts`, add above `createEditorViewport`:

```ts
export function pickRoots<T extends {root:Object3D;pickable?:boolean}>(objects: Map<string,T>): [string,T][] {
    return [...objects.entries()].filter(([,value])=>value.root.visible&&value.pickable!==false);
}
```

Change the parameter type `objects: Map<string,{root:Object3D}>` to `objects: Map<string,{root:Object3D;pickable?:boolean}>`, and in `pointerUp` replace `const roots=[...objects.entries()].filter(([,v])=>v.root.visible);` with `const roots=pickRoots(objects);`.

In `packages/renderer/src/renderer.ts`:

1. Add `import { createEnvironmentLight, roomEnvironmentMap } from "./environment-light";`.
2. After `const assets = createAssetCache(loadAsset);` add `const environmentLight = createEnvironmentLight(roomEnvironmentMap(renderer));`.
3. In `build`, after `const root = clone(asset.scene);` add `if (request.kind === "environment") environmentLight.apply(root);`.
4. Add `pickable?: boolean;` to the `objects` map value type.
5. In `cleanup`, after `assets.dispose();` add `environmentLight.dispose();`.
6. In `submit`, immediately after the two `cameraEntity` checks (before `const width = ...`), add:

```ts
        const showEnvironment = cameraEntity.renderEnvironment !== false;
        const place = (root: Object3D, entity: SceneEntity) => { applyTransform(root, entity); if (entity.kind === "environment" && !showEnvironment) root.visible = false; };
```

7. Replace the `assetId` line and the avatar-null check with:

```ts
            const assetId = entity.kind === "avatar" || entity.kind === "environment" ? entity.assetId : entity.source.kind === "asset" ? entity.source.assetId : null;
            let value = objects.get(entity.id);
            if ((entity.kind === "avatar" || entity.kind === "environment") && assetId === null) {
                if (value) { releaseObject(value); objects.delete(entity.id); }
                continue;
            }
```

8. Replace `needed.set(entity.id, { kind: entity.kind === "avatar" ? "avatar" : "mesh", assetId });` with `needed.set(entity.id, { kind: entity.kind === "avatar" ? "avatar" : entity.kind === "environment" ? "environment" : "mesh", assetId });`.
9. Replace both `if (!editor?.frozen(entity.id)) applyTransform(value.root, entity);` and `if (!editor?.frozen(entityId)) applyTransform(installed.root, entity);` with the same calls to `place(...)`.
10. In the install block, add `pickable: entity.kind !== "environment"` to the `installed` object literal.

- [ ] **Step 4: Run the renderer tests and the type check**

Run: `pnpm vitest run --project unit packages/renderer && pnpm --filter @opensekai/renderer check`
Expected: PASS. If `packages/renderer` has no `check` script, run `pnpm check` and confirm no error in `packages/renderer`.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer
git commit -m "Draw the environment with neutral lighting and the camera Render Environment flag" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

---

### Task 6: Editor

**Files:**
- Create: `apps/desktop/src/editor/environment.ts`
- Create: `apps/desktop/src/components/EnvironmentFields.svelte`
- Modify: `apps/desktop/src/editor/live-fields.ts:4` (AddKind)
- Modify: `apps/desktop/src/editor/authoring.ts` (factory, `importFailure` fallback)
- Modify: `apps/desktop/src/editor/asset-groups.ts`
- Modify: `apps/desktop/src/editor/model.ts` (two setters)
- Modify: `apps/desktop/src/components/Hierarchy.svelte` (Add menu, icon, duplicate budget)
- Modify: `apps/desktop/src/components/Inspector.svelte`
- Modify: `apps/desktop/src/EditorApp.svelte`
- Create: `apps/desktop/test/environment.test.ts`
- Modify: `apps/desktop/test/asset-groups.test.ts`, `apps/desktop/test/editor-model.test.ts`

**Interfaces:**
- Consumes: `import_scene` command (Task 4) returning `{ record: AssetRecord; name: string } | null`; patch ops (Task 1).
- Produces: `creditLine(credits: AssetCredits): string | null`; `sceneSourceOptions(assetId: string | null, assets: readonly AssetRecord[]): { value: string; label: string }[]`; `IMPORT_SCENE = '__import__'`; `sourceAction(value: string): { kind: 'import' } | { kind: 'select'; assetId: string | null }`; model `setEnvironmentModel(entityId, assetId, expectedRevision?)`, `setCameraRenderEnvironment(entityId, renderEnvironment, expectedRevision?)`.

- [ ] **Step 1: Write the failing editor tests**

Create `apps/desktop/test/environment.test.ts`:

```ts
import { expect, it } from 'vitest';
import { SceneEntitySchema, type AssetRecord } from '@opensekai/contracts';
import { makeAuthoringEntity, makeEmptyScene } from '../src/editor/authoring';
import { IMPORT_SCENE, creditLine, sceneSourceOptions, sourceAction } from '../src/editor/environment';
const record = (id: string, name: string): AssetRecord => ({ id, format: 'glb', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name });
it('creates an environment without a model', () => {
    const entity = makeAuthoringEntity('environment', 'stage', makeEmptyScene().entities);
    expect(SceneEntitySchema.safeParse(entity).success).toBe(true);
    expect(entity).toMatchObject({ kind: 'environment', name: 'Environment', assetId: null, visible: true });
});
it('writes the CC credit line of the sample room', () => {
    expect(creditLine({ title: 'Anime stylized room free', sourceUrl: 'https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d', author: 'CG Lads (https://sketchfab.com/CGlads)', license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)' }))
        .toBe('This work is based on "Anime stylized room free" (https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d) by CG Lads (https://sketchfab.com/CGlads) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)');
    expect(creditLine({ title: 'Room', sourceUrl: null, author: null, license: 'CC0' })).toBe('This work is based on "Room" licensed under CC0');
    expect(creditLine({ title: null, sourceUrl: null, author: null, license: null })).toBeNull();
});
it('lists scene assets, a missing model, and the import action', () => {
    const assets = [record('scene_a', 'Room'), record('avatar_b', 'Rem')];
    expect(sceneSourceOptions(null, assets)).toEqual([{ value: '', label: 'Choose model…' }, { value: 'scene_a', label: 'Room' }, { value: IMPORT_SCENE, label: 'Import file…' }]);
    expect(sceneSourceOptions('scene_gone', assets).map(o => o.label)).toEqual(['Choose model…', 'Room', 'Missing model', 'Import file…']);
});
it('maps a Source value to an action', () => {
    expect(sourceAction(IMPORT_SCENE)).toEqual({ kind: 'import' });
    expect(sourceAction('')).toEqual({ kind: 'select', assetId: null });
    expect(sourceAction('scene_a')).toEqual({ kind: 'select', assetId: 'scene_a' });
});
```

In `apps/desktop/test/asset-groups.test.ts`, add:

```ts
it('puts the environment group before cameras',()=>{
 const stage=makeAuthoringEntity('environment','stage',[]);
 expect(groupEntities([camera('c'),stage]).map(group=>group.key)).toEqual(['environment','camera']);
});
```

In `apps/desktop/test/editor-model.test.ts`, add (using the existing `fixture()` helper):

```ts
it('sets an environment model and a camera Render Environment flag through patches', async () => {
 const { model, session } = fixture();
 await model.load();
 const stage = { id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null } as SceneEntity;
 expect((await model.createEntity(stage, model.read().scene!.revision)).ok).toBe(true);
 expect((await model.setEnvironmentModel('stage', 'scene_a', model.read().scene!.revision)).ok).toBe(true);
 expect(session.inspect().entities.find(e => e.id === 'stage')).toMatchObject({ assetId: 'scene_a' });
 const camera = session.inspect().entities.find(e => e.kind === 'camera')!;
 expect((await model.setCameraRenderEnvironment(camera.id, false, model.read().scene!.revision)).ok).toBe(true);
 expect(session.inspect().entities.find(e => e.id === camera.id)).toMatchObject({ renderEnvironment: false });
 expect((await model.setEnvironmentModel('performer', 'scene_a')).ok).toBe(false);
 expect((await model.setCameraRenderEnvironment('stage', true)).ok).toBe(false);
});
```

If `model.load` or `model.createEntity` have different names in `editor-model.test.ts`, use the names the existing tests in that file use.

Run: `pnpm vitest run --project unit apps/desktop/test/environment.test.ts apps/desktop/test/asset-groups.test.ts apps/desktop/test/editor-model.test.ts`
Expected: FAIL (`../src/editor/environment` missing; `environment` not an AddKind; setters missing).

- [ ] **Step 2: Implement the pure editor modules**

Create `apps/desktop/src/editor/environment.ts`:

```ts
import type { AssetCredits, AssetRecord } from '@opensekai/contracts';
export const IMPORT_SCENE = '__import__';
export function creditLine({ title, author, license, sourceUrl }: AssetCredits): string | null {
    if (!title && !author && !license && !sourceUrl) return null;
    return ['This work is based on', title ? `"${title}"` : null, sourceUrl ? `(${sourceUrl})` : null, author ? `by ${author}` : null, license ? `licensed under ${license}` : null].filter(Boolean).join(' ');
}
export function sceneSourceOptions(assetId: string | null, assets: readonly AssetRecord[]) {
    const scenes = assets.filter(asset => asset.id.startsWith('scene_')).map(asset => ({ value: asset.id, label: asset.name }));
    const missing = assetId !== null && !scenes.some(scene => scene.value === assetId) ? [{ value: assetId, label: 'Missing model' }] : [];
    return [{ value: '', label: 'Choose model…' }, ...scenes, ...missing, { value: IMPORT_SCENE, label: 'Import file…' }];
}
export function sourceAction(value: string): { kind: 'import' } | { kind: 'select'; assetId: string | null } {
    return value === IMPORT_SCENE ? { kind: 'import' } : { kind: 'select', assetId: value || null };
}
```

In `apps/desktop/src/editor/live-fields.ts:4`, change to `export type AddKind='camera'|'character'|'environment'|TrackingConfig['kind'];`.

In `apps/desktop/src/editor/authoring.ts`:
- Add `environment:'Environment'` to the label map.
- After the `character` branch add `if(kind==='environment')return {...base,kind,assetId:null};`.
- Change `importFailure` to `export function importFailure(cause:unknown,fallback='Could not import avatar'):string {const parsed=AppErrorSchema.safeParse(cause);return parsed.success?parsed.data.message.slice(0,160):fallback;}`.

In `apps/desktop/src/editor/asset-groups.ts`, make `['environment','Environment']` the first entry of `categories`.

In `apps/desktop/src/editor/model.ts`, add after `setAvatarModel`:

```ts
  setEnvironmentModel(entityId:Id,assetId:Id|null,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=IdSchema.nullable().safeParse(assetId);if(!ofKind(entityId,'environment')||!parsed.success)return invalid();
   return patch({kind:'setEnvironmentModel',entityId,assetId:parsed.data},expectedRevision);
  },
  setCameraRenderEnvironment(entityId:Id,renderEnvironment:boolean,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   if(!ofKind(entityId,'camera'))return invalid();
   return patch({kind:'setCameraRenderEnvironment',entityId,renderEnvironment},expectedRevision);
  },
```

Run: `pnpm vitest run --project unit apps/desktop/test`
Expected: PASS.

- [ ] **Step 3: Implement the components**

Create `apps/desktop/src/components/EnvironmentFields.svelte`:

```svelte
<script lang="ts">
 import {Button,Select} from '@oshi-connect/ui';
 import type {AssetRecord} from '@opensekai/contracts';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {stageLabel} from '../editor/load-status';
 import {creditLine,sceneSourceOptions,sourceAction} from '../editor/environment';
 let {assetId,assets,status=null,importing=false,error=null,disabled=false,onselect,onimport}:{assetId:string|null;assets:readonly AssetRecord[];status?:AssetLoadStatus|null;importing?:boolean;error?:string|null;disabled?:boolean;onselect:(assetId:string|null)=>void;onimport:()=>void}=$props();
 const credits=$derived(assets.find(asset=>asset.id===assetId)?.credits);
 const line=$derived(credits?creditLine(credits):null);
 let reset=$state(0),copied=$state(false);
 $effect(()=>{void assetId;copied=false;});
 function change(value:string){const action=sourceAction(value);reset++;if(action.kind==='import')onimport();else onselect(action.assetId);}
 async function copy(){if(!line)return;try{await navigator.clipboard.writeText(line);copied=true;}catch{copied=false;}}
</script>
<div class="environment-source">
 {#key `${assetId}:${reset}`}<Select label="Source" value={assetId??''} options={sceneSourceOptions(assetId,assets)} disabled={disabled||importing} onchange={event=>change(event.currentTarget.value)}/>{/key}
 {#if importing}<div class="source-status"><span>Importing…</span><progress max="1" aria-label="Importing…"></progress></div>
 {:else if status}<div class="source-status" class:failed={status.stage==='failed'}><span>{stageLabel(status)}</span>{#if status.stage!=='failed'}{#if status.progress===null}<progress max="1" aria-label={stageLabel(status)}></progress>{:else}<progress max="1" value={status.progress} aria-label={stageLabel(status)}></progress>{/if}{/if}</div>{/if}
 {#if error}<p class="source-status failed" role="alert">{error}</p>{/if}
 {#if credits&&line}<dl class="credits">{#if credits.title}<dt>Title</dt><dd>{credits.title}</dd>{/if}{#if credits.author}<dt>Author</dt><dd>{credits.author}</dd>{/if}{#if credits.license}<dt>License</dt><dd>{credits.license}</dd>{/if}</dl><Button variant="ghost" onclick={copy}>{copied?'Copied':'Copy credit'}</Button>{/if}
</div>
<style>
 .environment-source{display:grid;gap:8px;padding:12px 0;border-bottom:1px solid #e1dee6}
 .source-status{display:grid;gap:4px;font-size:11px;color:#85818f;margin:0}.source-status.failed{color:#b14050}progress{width:100%;height:5px;accent-color:#8571ac}
 .credits{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:12px}.credits dt{color:#85818f}.credits dd{margin:0;overflow-wrap:anywhere}
</style>
```

In `apps/desktop/src/components/Inspector.svelte`:
- Import `EnvironmentFields`.
- Add to `Props`: `importError?:string|null;onchoosescene?:(id:string)=>void;onpickscene?:(id:string,assetId:string|null)=>void;onrenderenvironment?:(id:string,value:boolean,revision:number)=>Promise<unknown>`, and destructure them (`importError=null`).
- Replace `{#if entity.kind==='camera'}<CameraLensFields .../>` with:

```svelte
 {#if entity.kind==='camera'}<label class="visibility-control"><input type="checkbox" checked={entity.renderEnvironment!==false} disabled={view.pending||disabled||!onrenderenvironment} onchange={event=>{void onrenderenvironment?.(entity.id,event.currentTarget.checked,view.scene!.revision);}}/>Render Environment</label><CameraLensFields entityId={entity.id} lens={entity.lens} revision={view.scene.revision} disabled={view.pending||disabled} oncommit={onlens}/>{:else if entity.kind==='environment'}<EnvironmentFields assetId={entity.assetId} {assets} status={loads.find(load=>load.entityId===entity.id)??null} importing={importingId===entity.id} error={importError} disabled={view.pending||livePending||disabled||!onchoosescene} onselect={assetId=>onpickscene?.(entity.id,assetId)} onimport={()=>onchoosescene?.(entity.id)}/>
```

and keep the existing `{:else if entity.kind==='avatar'}` branch after it.

In `apps/desktop/src/components/Hierarchy.svelte`:
- Add `Mountain` to the `@lucide/svelte` import.
- In the Add menu list, insert `['environment','Environment']` after `['character','Character']`, and change `const full=...` to `const full=(kind==='character'&&(view.scene?.entities.filter(e=>e.kind==='avatar').length??0)>=2)||(kind==='environment'&&(view.scene?.entities.some(e=>e.kind==='environment')??false));`.
- In the row icon chain, add `{:else if entity.kind==='environment'}<Mountain size={15}/>` before `{:else}`.
- In `budgetFull`, add `||entity.kind==='environment'`.

In `apps/desktop/src/EditorApp.svelte`, add after `chooseModel`:

```ts
 async function chooseScene(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_scene');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   await model.setEnvironmentModel(entityId,record.id,model.read().scene?.revision);
  }catch(cause){importError=importFailure(cause,'Could not import model');}finally{importingId=null;}
 }
```

and pass to `<Inspector ...>`: `{importError} onchoosescene={chooseScene} onpickscene={(id,assetId)=>{void model?.setEnvironmentModel(id,assetId,view.scene?.revision);}} onrenderenvironment={async(id,value,revision)=>{await model?.setCameraRenderEnvironment(id,value,revision);}}`.

- [ ] **Step 4: Run all checks**

Run: `pnpm check && pnpm test:unit && pnpm test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src apps/desktop/test
git commit -m "Add the Environment asset, Source select, credits, and Render Environment to the editor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

---

### Task 7: Live macOS check, evidence, parity, and the code map

**Files:**
- Create: `docs/evaluation/environment-import.md` and captured images in `docs/evaluation/`
- Modify: `docs/warudo-parity.md` (ENV-01 line and an evidence ledger row)
- Modify: `ARCHITECTURE.md` (Asset path step 1)
- Modify: `README.md` (the feature list, one bullet)

**Interfaces:**
- Consumes: the full slice. Sample: `/Users/danirukun/Downloads/Anime Stylized Room Free` (CC-BY-4.0, CG Lads). Use the computer-use skill for editor and dialog actions and the OpenSekai MCP tools (`scene_inspect`, `scene_patch`, `capture_frame`) for state and captures. OBS WebSocket: `ws://127.0.0.1:4455`, no authentication. Use an isolated OpenSekai test source; do not stream; keep existing OBS settings.

- [ ] **Step 1: Build and start the dev app**

Run: `pnpm dev:desktop` (background). Wait for the Scene and Editor windows. Record the commit with `git rev-parse --short HEAD`.

- [ ] **Step 2: Folder import**

With computer use: in the Editor, Assets **Add** → **Environment**. Confirm the Add item is then disabled. In Properties, **Source** → **Import file…**, choose `/Users/danirukun/Downloads/Anime Stylized Room Free/scene.gltf`. Record the time from the dialog close to the record return (editor `Importing…` to the Source label `Anime stylized room free`). Watch the load overlay stages. Check with `scene_inspect` that the environment `assetId` starts with `scene_`.

- [ ] **Step 3: Zip import**

Run: `ditto -c -k --sequesterRsrc "/Users/danirukun/Downloads/Anime Stylized Room Free" "$TMPDIR/anime-room.zip"`. Import the zip through **Import file…**. Expected: the same `scene_` asset ID, because the packed bytes are equal. If the ID differs, record why (for example the root stem); this is not a failure by itself.

- [ ] **Step 4: Appearance and character**

Add or keep a character with the operator VRM. Capture the Scene preview and an OBS capture. Check that glossy surfaces (music player, door) show reflections and that the character looks the same as a capture without the environment. Save images to `docs/evaluation/environment-import-*.png`.

- [ ] **Step 5: Render Environment and alpha**

In the camera Inspector, turn **Render Environment** off. Capture OBS output on the isolated test source. Then turn it on and off again once through MCP `scene_patch` with `{"kind":"setCameraRenderEnvironment","entityId":"<output camera>","renderEnvironment":false}`, and confirm that the editor switch follows (R25). Read the asset record through MCP if an MCP tool or resource lists assets, and confirm that `credits` is present; if none lists assets, record that. Compare alpha with the existing smoke_v1 transparent output: the room is gone and the background alpha is 0. Turn it on again and capture.

- [ ] **Step 6: Persistence and missing model**

Save As a show, Open it, and confirm the environment and the camera flag with `scene_inspect`. Quit the app, move `<app local data>/assets/library/scene_<sha>.glb` and its `.json` to a temporary folder, restart, Open the show: the Source shows `Missing model`. Restore the files.

- [ ] **Step 7: Memory, timing, minimized motion**

With the avatar and the room loaded, sample the Scene WebContent process footprint (the same WebKit footprint metric as `docs/evaluation/asset-management.md`, for example `footprint -p <pid>` or `vmmap --summary <pid>`; record which). Record app frame timing and OBS timing separately. Minimize the Editor and confirm continued OBS motion. Record each value, or `unknown` with the reason.

- [ ] **Step 8: Write the evaluation and update parity and the code map**

Create `docs/evaluation/environment-import.md` in ASD-STE100 with: commit, platform, renderer backend, quality profile, sample source URL and license, import times, memory samples, timing, each check result, and remaining gaps (cancel, Windows, Draco/meshopt/KTX2, props, sky).

In `docs/warudo-parity.md`, replace the ENV-01 "Planned slice 1 ... Not verified." text with the verified scope only, for example: `Partial: one environment for each scene from a local glTF, GLB, or zip, neutral environment lighting, and Render Environment for each camera, verified on macOS (<backend>) ([check](evaluation/environment-import.md)). Placement aids, props, Windows, and compressed formats remain.` Add one evidence ledger row with commit, scope, platform/backend, evidence link, and remaining gap.

In `ARCHITECTURE.md`, change Asset path step 1 to name both commands: `import_avatar` accepts `.vrm`; `import_scene` accepts `.glb`, `.gltf`, and `.zip` and packs external buffers and images into one GLB (`assets/scene_import.rs`) before the registry stores it. In the Output path paragraph, add that an environment uses a PMREM `RoomEnvironment` map on its own materials and that a camera can hide it with `renderEnvironment`.

In `README.md`, add one bullet under **Scene and editor**: `An environment (glTF, GLB, or zip) behind the characters, with Render Environment for each camera.`

- [ ] **Step 9: Commit and update the issue**

```bash
git add docs/evaluation docs/warudo-parity.md ARCHITECTURE.md README.md
git commit -m "Record the environment import check and ENV-01 parity" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GB1ejXrX4VXRJn1ZhYzPGg"
```

Comment on #147 with the verified scope, the evidence link, and the remaining gaps. Keep #39 open. Do not push unless the operator asks.
