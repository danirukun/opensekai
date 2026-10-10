# Character Model and Load Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a character a normal scene asset with a Model field, load models in the background so the preview and OBS output never freeze, and show load status in the Scene window and the editor.

**Architecture:** The avatar `assetId` becomes nullable, and a new `setAvatarModel` scene operation sets it (TypeScript and Rust contracts, session, MCP through `scene_patch`). Asset records gain a stored `name`. The renderer moves model loading out of frame submission into a per-entity load job table (`load-jobs.ts`). Each job downloads, decodes, builds, and GPU-prepares the model, then the next frame installs it. The job table reports status. The Scene window renders a centered overlay from that status and forwards it to the editor over the existing UI bridge.

**Tech Stack:** TypeScript 6, zod, Svelte 5, `@oshi-connect/ui`, three.js 0.180.0 (`three/webgpu`), `@pixiv/three-vrm` 3.5.5, Rust (serde, axum, Tauri v2), vitest 5, cargo test.

**Spec:** `spdd/prompt/2026-10-09-character-model.md` (REASONS) and `spdd/analysis/2026-10-09-character-model.md`.

## Global Constraints

- Use pnpm. Do not add npm or yarn. Do not add dependencies.
- Build UI controls with `@oshi-connect/ui` (`Button`, `Spinner`). Use the native `<progress>` element for progress bars; the kit has no progress primitive.
- UI copy is limited to: `Character`, `Model`, `Choose VRM…`, `Missing model`, `Importing…`, `Loading <name>`, `Downloading`, `Textures <done> of <total>`, `Preparing`, the error message, and `Dismiss`.
- Write prose (docs, commit bodies) in ASD-STE100 Simplified Technical English.
- Prefer functional TypeScript and plain data. Add a comment only when logic is hard to follow.
- `assetId` stays a **required nullable** key (`Id | null`). Never make it optional.
- Do not render a placeholder for a character with no model.
- Do not put the overlay or status text in the canvas, captures, or the OBS output.
- Send load status over the UI bridge only on a stage change, and progress at most 5 times per second.
- A stale or cancelled job must not add a model or leak GPU resources.
- Do not claim that GPU preparation removes the first-frame stall unless the Safari measurement (Task 9) shows it.
- Before Git operations, verify `pwd` is the repository root. Do not use `git -C` or compound `cd` commands.
- End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Fast model swaps** (A → B → C before A finishes): only C is installed; A and B results are disposed when they finish. Test: Task 5, `replaces a pending job and disposes its late result`.
2. **Character removed during a load**: the result is disposed and never enters the scene. Test: Task 5 (`cancels a job whose entity is gone`) and Task 6 (`disposes a model whose character was removed during load`).
3. **Library record without `name`, or with an unreadable `.vrm`**: the registry still loads and names the record from the VRM meta, else `Avatar`. Test: Task 3, `fills a missing name from stored VRM meta` and `legacy record with unreadable file falls back to Avatar`.
4. **Two characters with the same model**: each has its own job and status row, keyed by entity. Test: Task 5, `keeps separate jobs for two entities with one asset`.
5. **Show with a missing asset ID**: the Model row shows `Missing model`, the renderer reports `failed` once, and does not retry each frame. Test: Task 5 (`does not restart a failed job`) and Task 8 (`modelLabel`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/contracts/src/schema.ts`, `types.ts` | Nullable avatar `assetId`, `setAvatarModel`, `AssetRecord.name`, `ResourceHost.readAsset` progress callback |
| `crates/contracts/src/lib.rs` | Same contract in Rust |
| `crates/contracts/tests/character_model.rs` (new) | Rust contract tests |
| `packages/contracts/test/character-model.test.ts` (new) | TS contract tests |
| `fixtures/protocol/validation-vectors.json`, `fixtures/smoke/manifest.json` | Shared invalid vectors; fixture asset names |
| `packages/session/src/scene-ops.ts` | Apply `setAvatarModel` |
| `apps/desktop/src-tauri/src/assets/registry.rs` | Store and backfill `name` |
| `packages/browser-client/src/client.ts` | Download progress |
| `packages/renderer/src/load-jobs.ts` (new) | Job table, cancellation, status list |
| `packages/renderer/src/assets.ts` | Download and texture progress reports |
| `packages/renderer/src/renderer.ts` | Non-blocking install, GPU preparation, `onLoadStatus`, `dismissLoad` |
| `apps/desktop/src/editor/load-status.ts` (new) | Stage labels and the throttled bridge sender |
| `apps/desktop/src/editor/ui-message.ts` | `loadStatus` bridge message |
| `apps/desktop/src/components/LoadOverlay.svelte` (new) | Scene overlay card |
| `apps/desktop/src/App.svelte`, `bootstrap.ts` | Scene window wiring |
| `apps/desktop/src/editor/authoring.ts`, `live-fields.ts`, `model.ts` | Character creation, model label, `setAvatarModel` |
| `apps/desktop/src/components/AvatarModelField.svelte` (new) | Inspector Model row |
| `Hierarchy.svelte`, `Inspector.svelte`, `AssetList.svelte`, `EditorApp.svelte` | Editor wiring |

---

### Task 1: Contracts — nullable avatar model, `setAvatarModel`, asset name

**Files:**
- Modify: `packages/contracts/src/schema.ts:103-108` (avatar), `:145-163` (`PatchOpSchema`), `:170-181` (`AssetRecordSchema`)
- Modify: `packages/contracts/src/types.ts:51-56` (avatar), `:92` (`LivePatchOp`), `:100` (`AssetRecord`), `:282-284` (`ResourceHost`)
- Modify: `crates/contracts/src/lib.rs:80-95` (avatar), `:140-190` (`PatchOp`), `:193` (`AssetRecord`), `:985-996` (`AssetRecord` validate)
- Modify: `fixtures/protocol/validation-vectors.json`, `fixtures/smoke/manifest.json`, `crates/contracts/tests/vectors.rs:147`
- Create: `crates/contracts/tests/character_model.rs`, `packages/contracts/test/character-model.test.ts`

**Interfaces:**
- Produces: `SceneEntity` avatar `assetId: Id | null`; `PatchOp` `{kind:'setAvatarModel';entityId:Id;assetId:Id|null}`; `AssetRecord.name: string` (1–128 UTF-16 units); `ResourceHost.readAsset(assetId: Id, onProgress?: (loaded: number, total: number | null) => void): Promise<ArrayBuffer>`. Rust: `SceneEntity::Avatar { asset_id: Option<Id>, .. }`, `PatchOp::SetAvatarModel { entity_id: Id, asset_id: Option<Id> }`, `AssetRecord { name: String, .. }`.

- [ ] **Step 1: Write the failing TypeScript test**

Create `packages/contracts/test/character-model.test.ts`:

```ts
import {it,expect} from 'vitest';
import {SceneViewSchema,ScenePatchSchema,AssetRecordSchema} from '../src/index';
const transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
const scene=(avatar:Record<string,unknown>)=>({schemaVersion:1,sceneId:'s',revision:0,outputs:[{id:'output_main',cameraId:'cam',width:1920,height:1080,fps:60}],entities:[
 {id:'cam',name:'Camera',visible:true,transform,kind:'camera',lens:{fovDegrees:40,near:.01,far:100}},
 {id:'char',name:'Character',visible:true,transform,kind:'avatar',...avatar}]});
const record={id:'avatar_x',format:'vrm',sha256:'a'.repeat(64),bytes:1,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name:'Rem'};
it('accepts a character with no model and keeps assetId required',()=>{
 expect(SceneViewSchema.safeParse(scene({assetId:null})).success).toBe(true);
 expect(SceneViewSchema.safeParse(scene({assetId:'avatar_x'})).success).toBe(true);
 expect(SceneViewSchema.safeParse(scene({})).success).toBe(false);
});
it('accepts setAvatarModel with an asset or null and rejects a missing assetId',()=>{
 const patch=(op:Record<string,unknown>)=>ScenePatchSchema.safeParse({sceneId:'s',expectedRevision:0,operations:[{kind:'setAvatarModel',entityId:'char',...op}]}).success;
 expect(patch({assetId:'avatar_x'})).toBe(true);
 expect(patch({assetId:null})).toBe(true);
 expect(patch({})).toBe(false);
});
it('requires a bounded asset name',()=>{
 expect(AssetRecordSchema.safeParse(record).success).toBe(true);
 const {name:_,...unnamed}=record;
 expect(AssetRecordSchema.safeParse(unnamed).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,name:''}).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,name:'a'.repeat(129)}).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,name:'a'.repeat(128)}).success).toBe(true);
});
```

- [ ] **Step 2: Write the failing Rust test**

Create `crates/contracts/tests/character_model.rs`:

```rust
use opensekai_contracts::{validate_value, AssetRecord, ScenePatch, SceneView};
use serde_json::{json, Value};
fn scene(avatar: Value) -> Value {
    let transform = json!({"position":[0,0,0],"rotation":[0,0,0,1],"scale":[1,1,1]});
    let mut character = json!({"id":"char","name":"Character","visible":true,"transform":transform,"kind":"avatar"});
    for (k, v) in avatar.as_object().unwrap() {
        character[k] = v.clone();
    }
    json!({"schemaVersion":1,"sceneId":"s","revision":0,
        "outputs":[{"id":"output_main","cameraId":"cam","width":1920,"height":1080,"fps":60}],
        "entities":[{"id":"cam","name":"Camera","visible":true,"transform":transform,"kind":"camera","lens":{"fovDegrees":40,"near":0.01,"far":100}}, character]})
}
#[test]
fn character_without_model_keeps_asset_key_required() {
    assert!(validate_value::<SceneView>(&scene(json!({"assetId":null}))).is_ok());
    assert!(validate_value::<SceneView>(&scene(json!({"assetId":"avatar_x"}))).is_ok());
    assert!(validate_value::<SceneView>(&scene(json!({}))).is_err());
}
#[test]
fn set_avatar_model_accepts_asset_or_null() {
    let patch = |op: Value| json!({"sceneId":"s","expectedRevision":0,"operations":[op]});
    assert!(validate_value::<ScenePatch>(&patch(json!({"kind":"setAvatarModel","entityId":"char","assetId":"avatar_x"}))).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(json!({"kind":"setAvatarModel","entityId":"char","assetId":null}))).is_ok());
    assert!(validate_value::<ScenePatch>(&patch(json!({"kind":"setAvatarModel","entityId":"char"}))).is_err());
}
#[test]
fn asset_record_requires_bounded_name() {
    let record = json!({"id":"avatar_x","format":"vrm","sha256":"a".repeat(64),"bytes":1,"sourceUrl":null,"licenseLabel":"User supplied","importerVersion":1,"name":"Rem"});
    assert!(validate_value::<AssetRecord>(&record).is_ok());
    let mut unnamed = record.clone();
    unnamed.as_object_mut().unwrap().remove("name");
    assert!(validate_value::<AssetRecord>(&unnamed).is_err());
    for bad in [json!(""), json!("   "), json!("a".repeat(129))] {
        let mut v = record.clone();
        v["name"] = bad;
        assert!(validate_value::<AssetRecord>(&v).is_err());
    }
}
```

- [ ] **Step 3: Run both tests and confirm they fail**

Run: `pnpm exec vitest run --project unit packages/contracts/test/character-model.test.ts`
Expected: FAIL (null `assetId` rejected; unknown `setAvatarModel`; unknown key `name`).

Run: `cargo test -p opensekai-contracts --test character_model`
Expected: FAIL (`assetId: null` and `setAvatarModel` rejected; `name` unknown field).

- [ ] **Step 4: Change the TypeScript contract**

In `packages/contracts/src/schema.ts`, the avatar member of `SceneEntitySchema`:

```ts
    EntityBaseSchema.extend({
        kind: z.literal("avatar"),
        assetId: IdSchema.nullable(),
        tracking: AvatarTrackingSchema.optional(),
        idleAnimation: AvatarIdleSchema.optional()
    }),
```

Add to `PatchOpSchema`, after the `setAvatarTracking` line:

```ts
    z.strictObject({kind:z.literal('setAvatarModel'),entityId:IdSchema,assetId:IdSchema.nullable()}),
```

Add `name` as the last field of `AssetRecordSchema`:

```ts
    importerVersion: z.literal(1),
    name: z.string().refine(name => name.trim().length > 0 && name.length <= 128, 'Invalid asset name')
```

In `packages/contracts/src/types.ts`: change the avatar member to `assetId: Id | null;`, append `|{kind:'setAvatarModel';entityId:Id;assetId:Id|null}` to `LivePatchOp`, add `name: string;` to `interface AssetRecord`, and change `ResourceHost`:

```ts
export interface ResourceHost {
    readAsset(assetId: Id, onProgress?: (loaded: number, total: number | null) => void): Promise<ArrayBuffer>;
}
```

- [ ] **Step 5: Change the Rust contract**

In `crates/contracts/src/lib.rs`, the `Avatar` variant:

```rust
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
```

Add to `enum PatchOp` after `SetAvatarTracking`:

```rust
    SetAvatarModel {
        #[serde(rename = "entityId")]
        entity_id: Id,
        #[serde(rename = "assetId")]
        asset_id: Option<Id>,
    },
```

Change the `AssetRecord` declaration and its validation:

```rust
object!(AssetRecord {id:Id,format:AssetFormat,sha256:String,bytes:u64,source_url:Option<String>,license_label:String,importer_version:u32,name:String});
```

```rust
impl Validate for AssetRecord {
    fn validate(&self) -> Result<(), AppError> {
        scalar_checks(&serde_json::to_value(self).map_err(|e| invalid(e.to_string()))?)?;
        require(self.importer_version == 1, "unsupported importer version")?;
        require(
            !self.name.trim().is_empty() && self.name.encode_utf16().count() <= 128,
            "invalid asset name",
        )?;
        require(
            self.source_url
                .as_ref()
                .is_none_or(|s| url::Url::parse(s).is_ok()),
            "invalid source URL",
        )?;
        hash(&self.sha256)
    }
}
```

Run `cargo build -p opensekai-contracts`. Fix each compile error that the `Option<Id>` change causes by matching `Option`; there are no other Rust readers of the avatar `asset_id` in `crates/` or `apps/desktop/src-tauri/src/` (checked with `grep -rn asset_id`).

- [ ] **Step 6: Update fixtures and vectors**

In `fixtures/smoke/manifest.json`, add `"name": "VRM1 Constraint Twist Sample"` to `fixture_vrm_1` and `"name": "Reference box"` to `fixture_glb_1`.

In `fixtures/protocol/validation-vectors.json`: add `"name": "Fixture"` to the payload of `invalid-source-url` (so it still fails only for the URL), and append two invalid vectors: `avatar-missing-asset-key` (the `unknown-field` scene payload without its unknown field and without `performer.assetId`) and `asset-missing-name` (an asset record without `name`). Make the change with this script so that the payloads are exact:

```bash
python3 - <<'EOF'
import json
p='fixtures/protocol/validation-vectors.json'; d=json.load(open(p))
base=next(v for v in d if v['name']=='unknown-field')['payload']
scene=json.loads(json.dumps(base))
for k in [k for k in scene if k not in ('schemaVersion','sceneId','revision','entities','outputs')]: del scene[k]
for e in scene['entities']:
    for k in [k for k in e if k not in ('id','name','visible','transform','kind','source','assetId','lens','tracking','idleAnimation')]: del e[k]
next(e for e in scene['entities'] if e['id']=='performer').pop('assetId')
next(v for v in d if v['name']=='invalid-source-url')['payload']['name']='Fixture'
d.append({'name':'avatar-missing-asset-key','target':'scene','valid':False,'errorCode':'INVALID_INPUT','payload':scene})
d.append({'name':'asset-missing-name','target':'asset','valid':False,'errorCode':'INVALID_INPUT','payload':{'id':'fixture_glb_1','format':'glb','sha256':'a'*64,'bytes':1,'sourceUrl':None,'licenseLabel':'CC0','importerVersion':1}})
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
EOF
```

In `crates/contracts/tests/vectors.rs:147`, add `"name":"Test"` to the `asset` literal so it still fails only on `sourceUrl`.

- [ ] **Step 7: Run the contract tests**

Run: `pnpm exec vitest run --project unit packages/contracts`
Expected: PASS, including `shared vector avatar-missing-asset-key` and `shared vector asset-missing-name`.

Run: `cargo test -p opensekai-contracts`
Expected: PASS (all tests, including `character_model` and `expanded_shared_vectors`).

- [ ] **Step 8: Type-check dependents**

Run: `pnpm check`
Expected: errors only where code reads an avatar `assetId` as a string: `packages/renderer/src/renderer.ts:110` and `apps/desktop/src/editor/authoring.ts:17`. Leave them; Tasks 6 and 8 change those files. Record the error list in the task report. Any other error must be fixed in this task.

- [ ] **Step 9: Commit**

```bash
pwd
git add packages/contracts crates/contracts fixtures
git commit -m "Let a character exist without a model and store asset names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Session — apply `setAvatarModel`

**Files:**
- Modify: `packages/session/src/scene-ops.ts:24-25`
- Create: `packages/session/test/avatar-model-patch.test.ts`

**Interfaces:**
- Consumes: `PatchOp` `setAvatarModel` (Task 1).
- Produces: `session.applyPatch` handles `setAvatarModel`.

- [ ] **Step 1: Write the failing test**

```ts
import {it,expect} from 'vitest';
import {makeSmokeScene} from '@opensekai/contracts';
import {createSession} from '../src/session';
const patch=(revision:number,operations:unknown[])=>({sceneId:'scene_smoke',expectedRevision:revision,operations} as never);
it('sets, replaces, and clears an avatar model atomically',()=>{
 const s=createSession(makeSmokeScene(),'model-test');
 expect(s.applyPatch(patch(0,[{kind:'setAvatarModel',entityId:'performer',assetId:'avatar_b'}])).ok).toBe(true);
 expect(s.inspect().entities.find(e=>e.id==='performer')).toMatchObject({assetId:'avatar_b'});
 expect(s.applyPatch(patch(1,[{kind:'setAvatarModel',entityId:'performer',assetId:null}])).ok).toBe(true);
 expect(s.inspect().entities.find(e=>e.id==='performer')).toMatchObject({assetId:null});
});
it('rejects a non-avatar or unknown entity and keeps the scene',()=>{
 const s=createSession(makeSmokeScene(),'model-test');const before=s.inspect();
 expect(s.applyPatch(patch(0,[{kind:'setVisibility',entityId:'performer',visible:false},{kind:'setAvatarModel',entityId:'marker',assetId:'avatar_b'}]))).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(s.applyPatch(patch(0,[{kind:'setAvatarModel',entityId:'nobody',assetId:null}]))).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
 expect(s.inspect()).toEqual(before);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run --project unit packages/session/test/avatar-model-patch.test.ts`
Expected: FAIL (`assetId` unchanged; the switch has no case).

- [ ] **Step 3: Implement**

In `packages/session/src/scene-ops.ts`, after the `setAvatarTracking` case:

```ts
                 case 'setAvatarModel':if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);entity.assetId=operation.assetId;break;
```

- [ ] **Step 4: Run session tests**

Run: `pnpm exec vitest run --project unit packages/session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pwd
git add packages/session
git commit -m "Apply setAvatarModel in the session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Native registry — store and backfill the asset name

**Files:**
- Modify: `apps/desktop/src-tauri/src/assets/registry.rs:75-99` (`load_library`), `:101-186` (`import_avatar`), tests module `:325+`
- Modify: `apps/desktop/src-tauri/tests/import_integration.rs` (assert `record.name`)
- Modify: `apps/desktop/src-tauri/src/show.rs` tests (R7: a show with a character that has no model)

**Interfaces:**
- Consumes: `AssetRecord.name` (Task 1).
- Produces: every record from `records()` and `ImportResult.record` has `name`. `ImportResult.name == ImportResult.record.name`.

- [ ] **Step 1: Write failing Rust unit tests**

Add to the `tests` module of `registry.rs` (the module already has the `vrm(json: &str) -> Vec<u8>` helper):

```rust
    fn without_meta_name() -> String {
        let mut v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/minimal-vrm1.json")).unwrap();
        v["extensions"]["VRMC_vrm"]["meta"]
            .as_object_mut()
            .unwrap()
            .remove("name");
        v.to_string()
    }
    #[test]
    fn import_stores_meta_name_or_file_stem() {
        let dir = tempfile::tempdir().unwrap();
        let mut r = AssetRegistry::empty(&dir.path().join("managed")).unwrap();
        let named = dir.path().join("named.vrm");
        std::fs::write(&named, vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"))).unwrap();
        let a = r.import_avatar(&named).unwrap();
        assert_eq!(a.record.name, "Test avatar");
        assert_eq!(a.name, a.record.name);
        let stem = dir.path().join("Rem Model.vrm");
        std::fs::write(&stem, vrm(&without_meta_name())).unwrap();
        assert_eq!(r.import_avatar(&stem).unwrap().record.name, "Rem Model");
    }
    #[test]
    fn fills_a_missing_name_from_stored_vrm_meta() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.vrm");
        std::fs::write(&source, vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"))).unwrap();
        let managed = dir.path().join("managed");
        let id = AssetRegistry::empty(&managed).unwrap().import_avatar(&source).unwrap().record.id;
        let json = managed.join("library").join(format!("{id}.json"));
        let mut legacy: Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("name");
        std::fs::write(&json, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let reopened = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(reopened.records()[0].name, "Test avatar");
        let rewritten: Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
        assert_eq!(rewritten["name"], "Test avatar");
    }
    #[test]
    fn legacy_record_with_unreadable_file_falls_back_to_avatar() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.vrm");
        std::fs::write(&source, vrm(include_str!("../../tests/fixtures/minimal-vrm1.json"))).unwrap();
        let managed = dir.path().join("managed");
        let id = AssetRegistry::empty(&managed).unwrap().import_avatar(&source).unwrap().record.id;
        let library = managed.join("library");
        let json = library.join(format!("{id}.json"));
        let mut legacy: Value = serde_json::from_slice(&std::fs::read(&json).unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("name");
        std::fs::write(&json, serde_json::to_vec(&legacy).unwrap()).unwrap();
        std::fs::write(library.join(format!("{id}.vrm")), b"not a glb").unwrap();
        let reopened = AssetRegistry::empty(&managed).unwrap();
        assert_eq!(reopened.records()[0].name, "Avatar");
    }
```

In `apps/desktop/src-tauri/tests/import_integration.rs`, after `assert_eq!(imported.name, "Test avatar");` add `assert_eq!(imported.record.name, "Test avatar");`.

Add this test to the `tests` module of `apps/desktop/src-tauri/src/show.rs` (R7):

```rust
    #[test]
    fn round_trip_keeps_a_character_without_model() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty-character.osekai");
        let mut document = show();
        document["scene"]["entities"][1]["assetId"] = json!(null);
        assert!(validate_show(&document).is_ok());
        write_show(&path, &document).unwrap();
        assert_eq!(read_show(&path).unwrap(), document);
        document["scene"]["entities"][1]
            .as_object_mut()
            .unwrap()
            .remove("assetId");
        assert!(validate_show(&document).is_err());
    }
```

Before you run it, confirm that `fixtures/protocol/valid-scene.json` has the avatar at `entities[1]` (the existing `round_trip_keeps_references_and_replaces_existing_file` test uses the same index).

Check the managed root layout before running: `AssetRegistry::empty(root)` puts the library at `root/library` (see `registry.rs:61`).

- [ ] **Step 2: Run them and confirm they fail**

Run: `cargo test -p opensekai-desktop --lib assets::registry`
Expected: compile error (missing `name` in `AssetRecord` initializer) or test failures.

- [ ] **Step 3: Implement name extraction and import**

Add near `validate_import_file`:

```rust
fn bounded_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let mut units = 0;
    Some(
        name.chars()
            .take_while(|c| {
                units += c.len_utf16();
                units <= 128
            })
            .collect(),
    )
}
fn meta_name(json: &Value) -> Option<String> {
    json.pointer("/extensions/VRMC_vrm/meta/name")
        .or_else(|| json.pointer("/extensions/VRM/meta/title"))
        .and_then(Value::as_str)
        .and_then(bounded_name)
}
fn stored_meta_name(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    meta_name(&validate_import_file(&mut file, len).ok()?)
}
```

In `import_avatar`, compute the name before building the record and use it:

```rust
        let name = meta_name(&json)
            .or_else(|| path.file_stem().and_then(|s| s.to_str()).and_then(bounded_name))
            .unwrap_or_else(|| "Avatar".into());
        let record = AssetRecord {
            id: id.clone(),
            format: opensekai_contracts::AssetFormat::Vrm,
            sha256,
            bytes: count,
            source_url: None,
            license_label: "User supplied".into(),
            importer_version: 1,
            name: name.clone(),
        };
```

Delete the old `let name = json.pointer(...)...collect();` block at the end and keep `Ok(ImportResult { record, name })`.

- [ ] **Step 4: Implement the backfill in `load_library`**

Replace the record parsing in `load_library` with:

```rust
            if p.extension().is_some_and(|s| s == "json") {
                let Ok(mut value) = std::fs::read(&p)
                    .map_err(|_| ())
                    .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| ()))
                else {
                    continue;
                };
                let stored = p.with_extension("vrm");
                let backfilled = value.get("name").is_none() && value.is_object();
                if backfilled {
                    value["name"] = Value::String(
                        stored_meta_name(&stored).unwrap_or_else(|| "Avatar".into()),
                    );
                }
                let Ok(record) = serde_json::from_value::<AssetRecord>(value) else {
                    continue;
                };
                if record.validate().is_ok()
                    && opaque(&record.id)
                    && record.id == format!("avatar_{}", record.sha256)
                {
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
                        Entry {
                            path: library.join(format!("{}.vrm", record.id)),
                            record,
                        },
                    );
                }
            }
```

- [ ] **Step 5: Run the Rust tests**

Run: `cargo test -p opensekai-desktop`
Expected: PASS, including the four new tests and `imported_avatar_is_served_by_opaque_id_and_survives_service_restart`.

- [ ] **Step 6: Commit**

```bash
pwd
git add apps/desktop/src-tauri/src/assets/registry.rs apps/desktop/src-tauri/src/show.rs apps/desktop/src-tauri/tests/import_integration.rs
git commit -m "Store the model name in each asset record

Read the name from VRM meta, then the file stem. Fill the name of an
older library record from its stored file, then use Avatar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Browser client — download progress

**Files:**
- Modify: `packages/browser-client/src/client.ts:174-185` (`read`), `:223` (`readAsset`)
- Create: `packages/browser-client/test/asset-progress.test.ts`

**Interfaces:**
- Consumes: `ResourceHost.readAsset(assetId, onProgress?)` (Task 1).
- Produces: `readAsset` streams the body and calls `onProgress(loaded, total)` per chunk; `total` is `Content-Length` or `null`.

- [ ] **Step 1: Write the failing test**

```ts
import {expect,it,vi} from 'vitest';
import {connectWithPorts} from '../src/client';
import type {BrowserClient,ConnectionDescriptor} from '@opensekai/contracts';
const descriptor:ConnectionDescriptor={schemaVersion:1,sessionId:'session_smoke',httpOrigin:'http://127.0.0.1:1234/',wsUrl:'ws://127.0.0.1:1234/ws',role:'operator',token:'local_test',capabilities:['read'],outputId:null};
class Socket extends EventTarget {bufferedAmount=0;send(){} close(){} }
function body(chunks:number[][]){return new ReadableStream<Uint8Array>({start(c){for(const chunk of chunks)c.enqueue(new Uint8Array(chunk));c.close();}});}
async function client(response:()=>Response){
 const socket=new Socket();
 const ready=connectWithPorts(descriptor,{socket:()=>socket,setTimeout,clearTimeout,fetch:vi.fn(async()=>response())});
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({kind:'authReply',schemaVersion:1,sessionId:descriptor.sessionId,capabilities:['read']})}));
 return await ready as BrowserClient;
}
it('reports streamed bytes against Content-Length and returns the whole asset',async()=>{
 const c=await client(()=>new Response(body([[1,2],[3,4,5]]),{headers:{'content-length':'5'}}));
 try{
  const progress=vi.fn();
  expect([...new Uint8Array(await c.readAsset('avatar_x',progress))]).toEqual([1,2,3,4,5]);
  expect(progress.mock.calls).toEqual([[2,5],[5,5]]);
 }finally{c.close();}
});
it('reports an unknown total without Content-Length',async()=>{
 const c=await client(()=>new Response(body([[9]])));
 try{const progress=vi.fn();await c.readAsset('avatar_x',progress);expect(progress.mock.calls).toEqual([[1,null]]);}finally{c.close();}
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec vitest run --project unit packages/browser-client/test/asset-progress.test.ts`
Expected: FAIL (progress is never called).

- [ ] **Step 3: Implement**

Replace `read` and `readAsset` in `client.ts`:

```ts
        const read = async (path: string, onProgress?: (loaded: number, total: number | null) => void): Promise<Uint8Array> => {
            if (closed)
                throw new Error("Client closed");
            const response = await ports.fetch(new URL(path, descriptor.httpOrigin), {
                headers: {
                    Authorization: `Bearer ${descriptor.token}`
                }
            });
            if (!response.ok)
                throw new Error(`Resource unavailable: ${response.status}`);
            if (!onProgress || !response.body)
                return new Uint8Array(await response.arrayBuffer());
            const length = Number(response.headers.get("content-length"));
            const total = Number.isSafeInteger(length) && length > 0 ? length : null;
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let loaded = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.byteLength;
                onProgress(loaded, total);
            }
            const bytes = new Uint8Array(loaded);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            return bytes;
        };
```

```ts
            readAsset: async (id, onProgress) => (await read(`/assets/${encodeURIComponent(id)}`, onProgress)).buffer as ArrayBuffer,
```

- [ ] **Step 4: Run browser-client tests**

Run: `pnpm exec vitest run --project unit packages/browser-client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pwd
git add packages/browser-client
git commit -m "Report asset download progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Renderer — load job table

**Files:**
- Create: `packages/renderer/src/load-jobs.ts`, `packages/renderer/test/load-jobs.test.ts`
- Modify: `packages/renderer/src/index.ts` (type exports)
- Modify: `spdd/prompt/2026-10-09-character-model.md` (E section: add `count` and `dismissLoad`)

**Interfaces:**
- Produces (exact):

```ts
export type LoadStage = 'download' | 'textures' | 'prepare' | 'failed';
export interface LoadReport { stage: Exclude<LoadStage, 'failed'>; progress: number | null; count?: { done: number; total: number } }
export interface AssetLoadStatus { entityId: string; assetId: string; stage: LoadStage; progress: number | null; count?: { done: number; total: number }; message?: string }
export interface LoadRequest { kind: 'avatar' | 'mesh'; assetId: string }
export function createLoadJobs<T extends { dispose(): void }>(
  start: (request: LoadRequest, report: (report: LoadReport) => void) => Promise<T>,
  onStatus: (entries: AssetLoadStatus[]) => void,
): {
  reconcile(needed: ReadonlyMap<string, LoadRequest>): void;
  take(entityId: string): T | undefined;
  failure(entityId: string): string | undefined;
  dismiss(entityId: string): void;
  assetIds(): Set<string>;
  status(): AssetLoadStatus[];
  dispose(): void;
}
```

Semantics: `reconcile` receives only the entities whose installed model differs from the wanted one. A job whose entity is absent, or whose request differs, is cancelled; a cancelled job's result is disposed when it settles, or at once if it is complete. A failed job is not restarted while its request is unchanged. `take` returns and removes a complete result. `status()` lists loading and failed (not dismissed) jobs in insertion order. `onStatus` is called after each change to that list.

- [ ] **Step 1: Write the failing tests**

```ts
import {it,expect,vi} from 'vitest';
import {createLoadJobs,type LoadRequest,type LoadReport} from '../src/load-jobs';
type Value={id:string;dispose:ReturnType<typeof vi.fn>};
function harness(){
 const pending=new Map<string,{resolve:(v:Value)=>void;reject:(e:unknown)=>void;report:(r:LoadReport)=>void}>();
 const values:Value[]=[];
 const start=vi.fn((request:LoadRequest,report:(r:LoadReport)=>void)=>new Promise<Value>((resolve,reject)=>{pending.set(request.assetId,{resolve,reject,report});}));
 const onStatus=vi.fn();
 const jobs=createLoadJobs<Value>(start,onStatus);
 const finish=async(assetId:string)=>{const v={id:assetId,dispose:vi.fn()};values.push(v);pending.get(assetId)!.resolve(v);await new Promise(r=>setTimeout(r,0));return v;};
 const fail=async(assetId:string,message:string)=>{pending.get(assetId)!.reject(new Error(message));await new Promise(r=>setTimeout(r,0));};
 return {jobs,start,onStatus,pending,finish,fail};
}
const need=(entries:[string,string][])=>new Map(entries.map(([entity,asset])=>[entity,{kind:'avatar' as const,assetId:asset}]));
it('starts one job per request and reports stages until it is complete',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));h.jobs.reconcile(need([['char','a']]));
 expect(h.start).toHaveBeenCalledTimes(1);
 expect(h.jobs.status()).toEqual([{entityId:'char',assetId:'a',stage:'download',progress:null}]);
 h.pending.get('a')!.report({stage:'textures',progress:.5,count:{done:12,total:24}});
 expect(h.onStatus).toHaveBeenLastCalledWith([{entityId:'char',assetId:'a',stage:'textures',progress:.5,count:{done:12,total:24}}]);
 const v=await h.finish('a');
 expect(h.jobs.status()).toEqual([]);expect(h.onStatus).toHaveBeenLastCalledWith([]);
 expect(h.jobs.take('char')).toBe(v);expect(h.jobs.take('char')).toBeUndefined();
});
it('replaces a pending job and disposes its late result',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));h.jobs.reconcile(need([['char','b']]));h.jobs.reconcile(need([['char','c']]));
 expect(h.start).toHaveBeenCalledTimes(3);
 const a=await h.finish('a'),b=await h.finish('b'),c=await h.finish('c');
 expect(a.dispose).toHaveBeenCalledOnce();expect(b.dispose).toHaveBeenCalledOnce();expect(c.dispose).not.toHaveBeenCalled();
 expect(h.jobs.take('char')).toBe(c);
});
it('cancels a job whose entity is gone and disposes a complete untaken result',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['one','a'],['two','b']]));
 const b=await h.finish('b');
 h.jobs.reconcile(need([]));
 expect(b.dispose).toHaveBeenCalledOnce();
 const a=await h.finish('a');
 expect(a.dispose).toHaveBeenCalledOnce();expect(h.jobs.take('one')).toBeUndefined();expect(h.jobs.status()).toEqual([]);
});
it('keeps separate jobs for two entities with one asset',async()=>{
 const resolvers:((v:Value)=>void)[]=[];
 const start=vi.fn(()=>new Promise<Value>(r=>{resolvers.push(r);}));
 const jobs=createLoadJobs<Value>(start,vi.fn());
 jobs.reconcile(need([['one','a'],['two','a']]));
 expect(start).toHaveBeenCalledTimes(2);expect(jobs.status().map(s=>s.entityId)).toEqual(['one','two']);
 const one={id:'a',dispose:vi.fn()};resolvers[0]!(one);await new Promise(r=>setTimeout(r,0));
 expect(jobs.status().map(s=>s.entityId)).toEqual(['two']);expect(jobs.take('one')).toBe(one);expect(jobs.take('two')).toBeUndefined();
});
it('does not restart a failed job and hides it after dismiss',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['char','a']]));await h.fail('a','Asset unavailable');
 h.jobs.reconcile(need([['char','a']]));
 expect(h.start).toHaveBeenCalledTimes(1);
 expect(h.jobs.status()).toEqual([{entityId:'char',assetId:'a',stage:'failed',progress:null,message:'Asset unavailable'}]);
 expect(h.jobs.failure('char')).toBe('Asset unavailable');
 h.jobs.dismiss('char');
 expect(h.jobs.status()).toEqual([]);expect(h.jobs.failure('char')).toBe('Asset unavailable');
 h.jobs.reconcile(need([['char','b']]));
 expect(h.start).toHaveBeenCalledTimes(2);expect(h.jobs.failure('char')).toBeUndefined();
});
it('lists asset IDs of live jobs and disposes everything on dispose',async()=>{
 const h=harness();
 h.jobs.reconcile(need([['one','a'],['two','b']]));
 expect(h.jobs.assetIds()).toEqual(new Set(['a','b']));
 const b=await h.finish('b');
 h.jobs.dispose();
 expect(b.dispose).toHaveBeenCalledOnce();
 const a=await h.finish('a');expect(a.dispose).toHaveBeenCalledOnce();
 h.jobs.reconcile(need([['one','c']]));expect(h.start).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec vitest run --project unit packages/renderer/test/load-jobs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `load-jobs.ts`**

```ts
export type LoadStage = 'download' | 'textures' | 'prepare' | 'failed';
export interface LoadReport { stage: Exclude<LoadStage, 'failed'>; progress: number | null; count?: { done: number; total: number } }
export interface AssetLoadStatus { entityId: string; assetId: string; stage: LoadStage; progress: number | null; count?: { done: number; total: number }; message?: string }
export interface LoadRequest { kind: 'avatar' | 'mesh'; assetId: string }

type Job<T> = { request: LoadRequest; state: 'loading' | 'ready' | 'failed'; status: AssetLoadStatus; value?: T; cancelled: boolean; dismissed: boolean };
const sameRequest = (a: LoadRequest, b: LoadRequest) => a.kind === b.kind && a.assetId === b.assetId;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createLoadJobs<T extends { dispose(): void }>(
  start: (request: LoadRequest, report: (report: LoadReport) => void) => Promise<T>,
  onStatus: (entries: AssetLoadStatus[]) => void,
) {
  const jobs = new Map<string, Job<T>>();
  let closed = false;
  const status = () => [...jobs.values()].filter(job => job.state === 'loading' || (job.state === 'failed' && !job.dismissed)).map(job => ({ ...job.status }));
  const emit = () => { if (!closed) onStatus(status()); };
  const cancel = (entityId: string) => {
    const job = jobs.get(entityId);
    if (!job) return;
    jobs.delete(entityId);
    job.cancelled = true;
    job.value?.dispose();
    job.value = undefined;
  };
  const begin = (entityId: string, request: LoadRequest) => {
    const job: Job<T> = { request, state: 'loading', status: { entityId, assetId: request.assetId, stage: 'download', progress: null }, cancelled: false, dismissed: false };
    jobs.set(entityId, job);
    const report = (next: LoadReport) => {
      if (job.cancelled || job.state !== 'loading') return;
      job.status = { entityId, assetId: request.assetId, ...next };
      emit();
    };
    let running: Promise<T>;
    try { running = start(request, report); } catch (error) { running = Promise.reject(error); }
    void running.then(value => {
      if (job.cancelled) { value.dispose(); return; }
      job.value = value;
      job.state = 'ready';
      emit();
    }, error => {
      if (job.cancelled) return;
      job.state = 'failed';
      job.status = { entityId, assetId: request.assetId, stage: 'failed', progress: null, message: messageOf(error) };
      emit();
    });
  };
  return {
    reconcile(needed: ReadonlyMap<string, LoadRequest>) {
      if (closed) return;
      let changed = false;
      for (const entityId of [...jobs.keys()]) {
        const request = needed.get(entityId);
        if (!request || !sameRequest(request, jobs.get(entityId)!.request)) { cancel(entityId); changed = true; }
      }
      for (const [entityId, request] of needed) if (!jobs.has(entityId)) { begin(entityId, request); changed = true; }
      if (changed) emit();
    },
    take(entityId: string): T | undefined {
      const job = jobs.get(entityId);
      if (job?.state !== 'ready') return undefined;
      jobs.delete(entityId);
      return job.value;
    },
    failure: (entityId: string) => { const job = jobs.get(entityId); return job?.state === 'failed' ? job.status.message : undefined; },
    dismiss(entityId: string) { const job = jobs.get(entityId); if (job?.state === 'failed' && !job.dismissed) { job.dismissed = true; emit(); } },
    assetIds: () => new Set([...jobs.values()].map(job => job.request.assetId)),
    status,
    dispose() { if (closed) return; for (const entityId of [...jobs.keys()]) cancel(entityId); closed = true; },
  };
}
```

Add to `packages/renderer/src/index.ts`:

```ts
export type { AssetLoadStatus, LoadStage } from "./load-jobs";
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project unit packages/renderer/test/load-jobs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Record the spec detail**

In `spdd/prompt/2026-10-09-character-model.md`, section E, replace the `AssetLoadStatus` line with:

```markdown
- `AssetLoadStatus`: `{ entityId, assetId, stage: 'download' | 'textures' | 'prepare' | 'failed', progress: number | null, count?: { done, total }, message?: string }`. `count` carries the texture numbers for the `Textures 12 of 24` line. Renderer and editor local; not a protocol type.
- `RendererHandle`: adds `onLoadStatus(listener)` and `dismissLoad(entityId)`. The Scene overlay **Dismiss** control calls `dismissLoad`.
```

- [ ] **Step 6: Commit**

```bash
pwd
git add packages/renderer/src/load-jobs.ts packages/renderer/src/index.ts packages/renderer/test/load-jobs.test.ts spdd/prompt/2026-10-09-character-model.md
git commit -m "Add a renderer load job table with status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer — background loading, GPU preparation, status

**Files:**
- Modify: `packages/renderer/src/assets.ts` (`inspectContainer`, `createAssetLoader`)
- Modify: `packages/renderer/src/renderer.ts:14-20` (`RendererHandle`), `:40-53`, `:96-155` (entity loop), `:63-73` (cleanup), `:185-191` (handle)
- Modify: `packages/renderer/test/asset-lifecycle.test.ts` (mock gets `compileAsync`; first test waits for the job)
- Create: `packages/renderer/test/renderer-loading.test.ts`

**Interfaces:**
- Consumes: `createLoadJobs`, `LoadReport`, `AssetLoadStatus` (Task 5); `readAsset(id, onProgress)` (Task 1).
- Produces: `createAssetLoader(resources, options)` returns `(id: string, report?: (report: LoadReport) => void) => Promise<LoadedAsset>`; `inspectContainer(bytes)` returns `{ extensions: string[]; imageCount: number }`; `RendererHandle.onLoadStatus(listener: (entries: AssetLoadStatus[]) => void): () => void` (calls the listener at once with the current list); `RendererHandle.dismissLoad(entityId: string): void`.

- [ ] **Step 1: Write the failing renderer tests**

Create `packages/renderer/test/renderer-loading.test.ts`:

```ts
import {it,expect,vi,beforeEach} from 'vitest';
import {Group} from 'three/webgpu';
import {makeSmokeFrame,type RuntimeFrame} from '@opensekai/contracts';
const ports=vi.hoisted(()=>({load:vi.fn(),render:vi.fn(),compile:vi.fn()}));
vi.mock('../src/backend',()=>({initializeBackend:async()=>({backend:'webgl2',renderer:{info:{memory:{geometries:0,textures:0}},setSize:vi.fn(),renderAsync:ports.render,compileAsync:ports.compile,dispose:vi.fn()}})}));
vi.mock('../src/assets',async original=>({...await original<typeof import('../src/assets')>(),createAssetLoader:()=>ports.load}));
vi.mock('../src/avatar-pose',()=>({createAvatarBinding:(vrm:{root:Group})=>({root:vrm.root,apply:vi.fn()})}));
import {createRenderer} from '../src/renderer';
const settle=()=>new Promise(r=>setTimeout(r,0));
let sequence=0;
function frame(assetId:string|null,withAvatar=true):RuntimeFrame{
 const f=makeSmokeFrame({sequence:++sequence,tick:sequence});
 f.scene.entities=f.scene.entities.filter(e=>e.kind==='camera'||(withAvatar&&e.kind==='avatar'));
 for(const e of f.scene.entities)if(e.kind==='avatar')e.assetId=assetId;
 return f;
}
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const asset=(root=new Group())=>({root,value:{scene:root,vrm:{root},warnings:[],dispose:vi.fn()}});
const rendered=()=>ports.render.mock.lastCall![0] as Group;
beforeEach(()=>{ports.load.mockReset();ports.render.mockReset().mockResolvedValue(undefined);ports.compile.mockReset().mockResolvedValue(undefined);});
async function make(){return createRenderer({canvas:{width:1920,height:1080} as HTMLCanvasElement,outputId:'output_main',mode:'force-webgl2',resources:{readAsset:vi.fn()},diagnostics:false,resolutionScale:1});}

it('renders frames while a model loads and installs it after GPU preparation',async()=>{
 const pending=deferred();ports.load.mockReturnValue(pending.promise);
 const r=await make();const statuses:unknown[]=[];r.onLoadStatus(s=>statuses.push(s));
 await r.applyFrame(frame('avatar_a'));
 const a=asset();
 expect(rendered().getObjectById(a.root.id)).toBeUndefined();
 expect(statuses.at(-1)).toEqual([expect.objectContaining({entityId:'performer',assetId:'avatar_a',stage:'download'})]);
 pending.resolve(a.value);await settle();
 expect(ports.compile).toHaveBeenCalledWith(a.root,expect.anything(),expect.anything());
 await r.applyFrame(frame('avatar_a'));
 expect(rendered().getObjectById(a.root.id)).toBe(a.root);
 expect(statuses.at(-1)).toEqual([]);
 expect(ports.load).toHaveBeenCalledTimes(1);
 r.dispose();
});
it('keeps the old model until the new model is ready',async()=>{
 const first=asset(),second=asset(),pending=deferred();
 ports.load.mockResolvedValueOnce(first.value).mockReturnValueOnce(pending.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));await settle();await r.applyFrame(frame('avatar_a'));
 await r.applyFrame(frame('avatar_b'));
 expect(rendered().getObjectById(first.root.id)).toBe(first.root);
 pending.resolve(second.value);await settle();
 await r.applyFrame(frame('avatar_b'));
 expect(rendered().getObjectById(first.root.id)).toBeUndefined();
 expect(rendered().getObjectById(second.root.id)).toBe(second.root);
 expect(first.value.dispose).toHaveBeenCalledOnce();
 r.dispose();
});
it('disposes a model whose character was removed during load',async()=>{
 const a=asset(),pending=deferred();ports.load.mockReturnValue(pending.promise);
 const r=await make();
 await r.applyFrame(frame('avatar_a'));
 await r.applyFrame(frame('avatar_a',false));
 pending.resolve(a.value);await settle();
 await r.applyFrame(frame('avatar_a',false));
 expect(a.value.dispose).toHaveBeenCalledOnce();
 expect(rendered().getObjectById(a.root.id)).toBeUndefined();
 r.dispose();
});
it('reports a failed load once, warns each frame, and does not retry',async()=>{
 ports.load.mockRejectedValue(new Error('Asset unavailable'));
 const r=await make();let last:unknown;r.onLoadStatus(s=>{last=s;});
 await r.applyFrame(frame('avatar_x'));await settle();
 const applied=await r.applyFrame(frame('avatar_x'));
 expect(last).toEqual([expect.objectContaining({stage:'failed',message:'Asset unavailable'})]);
 expect(applied.warnings).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNAVAILABLE',ids:['avatar_x']})]));
 await r.applyFrame(frame('avatar_x'));
 expect(ports.load).toHaveBeenCalledTimes(1);
 r.dismissLoad('performer');expect(last).toEqual([]);
 r.dispose();
});
it('loads nothing for a character with no model',async()=>{
 const r=await make();
 await r.applyFrame(frame(null));
 expect(ports.load).not.toHaveBeenCalled();
 expect(rendered().children.some(child=>child.type==='Group')).toBe(false);
 r.dispose();
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec vitest run --project unit packages/renderer/test/renderer-loading.test.ts`
Expected: FAIL (`onLoadStatus` is not a function; frames wait for the load).

- [ ] **Step 3: Add progress to the asset loader**

In `packages/renderer/src/assets.ts`:

1. Import the type: `import type { LoadReport } from "./load-jobs";`.
2. Change `inspectContainer` to return `{ extensions: json.extensionsUsed ?? [], imageCount: json.images?.length ?? 0 }` (its return type becomes `{ extensions: string[]; imageCount: number }`). Update its one caller.
3. Change the returned loader function of `createAssetLoader`:

```ts
    return async (id: string, report: (report: LoadReport) => void = () => {}) => {
        const lease = textures.acquire(id);
        const loader = new GLTFLoader();
        let imageFailure: unknown;
        let imageTotal = 0;
        const decoded = new Set<number>();
        loader.register(parser => {
            // Share decoding before GLTFLoader allocates another bitmap; keep each parser and texture wrapper independent.
            const decode = parser.loadImageSource.bind(parser);
            parser.loadImageSource = (index, imageLoader) => lease.load(index, () => images.decode(() => decode(index, imageLoader))).then(texture => {
                if (imageTotal > 0 && !decoded.has(index)) {
                    decoded.add(index);
                    report({ stage: 'textures', progress: decoded.size / imageTotal, count: { done: decoded.size, total: imageTotal } });
                }
                return texture;
            }).catch(error => { imageFailure = error; throw error; });
            return { name: "OPENSEKAI_shared_images" };
        });
        loader.register(parser => new VRMLoaderPlugin(parser, { mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial }) }));
        try {
            let percent = -1;
            report({ stage: 'download', progress: null });
            const bytes = await resources.readAsset(id, (loaded, total) => {
                const progress = total ? Math.min(1, loaded / total) : null;
                const next = progress === null ? -1 : Math.floor(progress * 100);
                if (next !== percent) { percent = next; report({ stage: 'download', progress }); }
            });
            const { extensions, imageCount } = inspectContainer(bytes);
            imageTotal = imageCount;
            if (imageTotal > 0) report({ stage: 'textures', progress: 0, count: { done: 0, total: imageTotal } });
            const gltf = await loader.parseAsync(bytes, "");
```

Keep the rest of the function as it is (VRM rotation, warnings, return value). Replace the old `for (const extension of extensions)` source with the destructured `extensions`.

- [ ] **Step 4: Rework the renderer entity loop**

In `packages/renderer/src/renderer.ts`:

1. Imports: add `import { createLoadJobs, type AssetLoadStatus, type LoadReport, type LoadRequest } from "./load-jobs";`. `Object3D`, `Mesh`, `BoxGeometry`, and `MeshStandardNodeMaterial` are already imported.
2. Extend `RendererHandle`:

```ts
    onLoadStatus(listener: (entries: AssetLoadStatus[]) => void): () => void;
    dismissLoad(entityId: string): void;
```

3. After `const assets = createAssetCache(loadAsset);` add the job table:

```ts
    type Ready = { root: Object3D; avatar?: ReturnType<typeof createAvatarBinding>; assetId?: string; assetDispose?: () => void; warnings: AppError[]; dispose(): void };
    const loadListeners = new Set<(entries: AssetLoadStatus[]) => void>();
    const build = async (request: LoadRequest, report: (r: LoadReport) => void): Promise<Ready> => {
        if (request.kind === "avatar") {
            const asset = await loadAsset(request.assetId, report);
            try {
                if (!asset.vrm) throw failure("INVALID_INPUT", "Avatar asset has no VRM");
                const avatar = createAvatarBinding(asset.vrm);
                report({ stage: "prepare", progress: null });
                await renderer.compileAsync(avatar.root, camera, scene);
                return { root: avatar.root, avatar, assetDispose: asset.dispose, warnings: asset.warnings, dispose: asset.dispose };
            } catch (error) { asset.dispose(); throw error; }
        }
        const asset = await assets.get(request.assetId);
        const root = clone(asset.scene);
        report({ stage: "prepare", progress: null });
        await renderer.compileAsync(root, camera, scene);
        return { root, assetId: request.assetId, warnings: asset.warnings, dispose: () => disposeInstance(root) };
    };
    const jobs = createLoadJobs<Ready>(build, entries => { for (const listener of loadListeners) listener(entries); });
```

4. In `cleanup`, call `jobs.dispose();` before `assets.dispose();`.
5. Declare `const needed = new Map<string, LoadRequest>();` before the entity loop. Replace the non-camera part of the loop (current lines 110–152) with:

```ts
            const assetId = entity.kind === "avatar" ? entity.assetId : entity.source.kind === "asset" ? entity.source.assetId : null;
            let value = objects.get(entity.id);
            if (entity.kind === "avatar" && assetId === null) {
                if (value) { releaseObject(value); objects.delete(entity.id); }
                continue;
            }
            const signature = entity.kind + ":" + (assetId ?? "box");
            if (value?.signature !== signature) {
                if (assetId === null) {
                    if (value) releaseObject(value);
                    value = { signature, root: new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({ color: 0x55aacc })), owned: true };
                    scene.add(value.root);
                    objects.set(entity.id, value);
                } else {
                    // The new model is still loading: keep posing the old model, if any, until the job installs the new one.
                    needed.set(entity.id, { kind: entity.kind === "avatar" ? "avatar" : "mesh", assetId });
                    const message = jobs.failure(entity.id);
                    if (message) warnings.push({ code: "UNAVAILABLE", message: "Asset load failed: " + message, ids: [assetId] });
                    if (!value) continue;
                }
            }
            for (const warning of value.warnings ?? [])
                if (!warnings.some(x => x.message === warning.message && x.ids[0] === warning.ids[0])) warnings.push(warning);
            value.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entity.id));
            if (!editor?.frozen(entity.id)) applyTransform(value.root, entity);
```

6. After the loop, reconcile and install complete jobs:

```ts
        jobs.reconcile(needed);
        for (const [entityId, request] of needed) {
            const ready = jobs.take(entityId);
            if (!ready) continue;
            const entity = frame.scene.entities.find(item => item.id === entityId)!;
            const old = objects.get(entityId);
            if (old) releaseObject(old);
            const installed = { signature: entity.kind + ":" + request.assetId, root: ready.root, owned: false, avatar: ready.avatar, assetId: ready.assetId, assetDispose: ready.assetDispose, warnings: ready.warnings };
            scene.add(installed.root);
            objects.set(entityId, installed);
            installed.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entityId));
            if (!editor?.frozen(entityId)) applyTransform(installed.root, entity);
            warnings.push(...ready.warnings);
        }
```

7. Keep pending mesh assets cached: change the retain line to

```ts
        const used = new Set([...objects.values()].flatMap(x => x.assetId ? [x.assetId] : []));
        for (const id of jobs.assetIds()) used.add(id);
        assets.retainOnly(used);
```

8. Add to the returned handle object:

```ts
        onLoadStatus(listener) { loadListeners.add(listener); listener(jobs.status()); return () => { loadListeners.delete(listener); }; },
        dismissLoad(entityId) { jobs.dismiss(entityId); },
```

   Remove the now unused `if (disposed) {if (entity.kind === "avatar") asset.dispose();}` lines; `jobs.dispose()` in `cleanup` handles disposal.

- [ ] **Step 5: Update the existing lifecycle test**

In `packages/renderer/test/asset-lifecycle.test.ts`, add `compileAsync: vi.fn(async () => {})` to the mocked backend `renderer` object. In `releases an asset removed after failed render submission`, after the first `applyFrame` rejection add `await new Promise(r => setTimeout(r, 0));` so the background job settles, then keep the assertions. The mock asset has no `vrm`, so the job fails and disposes the asset once; the test's final expectation (`disposeAsset` called once) still holds.

- [ ] **Step 6: Run renderer tests and type-check**

Run: `pnpm exec vitest run --project unit packages/renderer`
Expected: PASS (all files, including `renderer-loading.test.ts`).

Run: `pnpm --filter @opensekai/renderer check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
pwd
git add packages/renderer
git commit -m "Load models in the background and report load status

Frame submission no longer waits for a model. A load job downloads,
decodes, builds, and prepares GPU pipelines for the model. The next
frame installs it. A replaced model stays visible until the new model
is ready.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Scene window — load overlay and bridge message

**Files:**
- Create: `apps/desktop/src/editor/load-status.ts`, `apps/desktop/test/load-status.test.ts`, `apps/desktop/src/components/LoadOverlay.svelte`
- Modify: `apps/desktop/src/editor/ui-message.ts` (type and parser), `apps/desktop/test/ui-message.test.ts`
- Modify: `apps/desktop/src/bootstrap.ts` (return `onLoadStatus`, `dismissLoad`), `apps/desktop/src/App.svelte`, `apps/desktop/src/app.css`

**Interfaces:**
- Consumes: `RendererHandle.onLoadStatus`, `dismissLoad`, `AssetLoadStatus` (Task 6).
- Produces: `UIMessage` member `{kind:'loadStatus';entries:AssetLoadStatus[]}`; `stageLabel(entry: AssetLoadStatus): string`; `createLoadStatusSender(send: (message: UIMessage) => Promise<void>, intervalMs?: number): { offer(entries: AssetLoadStatus[]): void; resend(): void; close(): void }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/test/load-status.test.ts`:

```ts
import {it,expect,vi} from 'vitest';
import {stageLabel,createLoadStatusSender} from '../src/editor/load-status';
const entry=(stage:'download'|'textures'|'prepare'|'failed',progress:number|null=null,extra={})=>({entityId:'char',assetId:'a',stage,progress,...extra});
it('labels each stage with the specified copy',()=>{
 expect(stageLabel(entry('download',.4))).toBe('Downloading');
 expect(stageLabel(entry('textures',.5,{count:{done:12,total:24}}))).toBe('Textures 12 of 24');
 expect(stageLabel(entry('prepare'))).toBe('Preparing');
 expect(stageLabel(entry('failed',null,{message:'Asset unavailable'}))).toBe('Asset unavailable');
});
it('sends stage changes at once and throttles progress to the interval',async()=>{
 vi.useFakeTimers();
 const send=vi.fn(async()=>{});const sender=createLoadStatusSender(send,200);
 sender.offer([entry('download',.1)]);expect(send).toHaveBeenCalledTimes(1);
 sender.offer([entry('download',.2)]);sender.offer([entry('download',.3)]);
 expect(send).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(200);
 expect(send).toHaveBeenCalledTimes(2);expect(send).toHaveBeenLastCalledWith({kind:'loadStatus',entries:[entry('download',.3)]});
 sender.offer([entry('prepare')]);expect(send).toHaveBeenCalledTimes(3);
 sender.offer([]);expect(send).toHaveBeenLastCalledWith({kind:'loadStatus',entries:[]});
 sender.resend();expect(send).toHaveBeenCalledTimes(5);
 sender.close();sender.offer([entry('download')]);expect(send).toHaveBeenCalledTimes(5);
 vi.useRealTimers();
});
```

Append to `apps/desktop/test/ui-message.test.ts`:

```ts
it('accepts bounded load status and rejects malformed entries',()=>{
 const ok={entityId:'char',assetId:'avatar_a',stage:'textures',progress:.5,count:{done:12,total:24}};
 expect(parseUIMessage({kind:'loadStatus',entries:[ok]})).toEqual({kind:'loadStatus',entries:[ok]});
 const failed={entityId:'char',assetId:'avatar_a',stage:'failed',progress:null,message:'Asset unavailable'};
 expect(parseUIMessage({kind:'loadStatus',entries:[failed]})).toEqual({kind:'loadStatus',entries:[failed]});
 expect(parseUIMessage({kind:'loadStatus',entries:Array(9).fill(ok)})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,progress:2}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,stage:'parse'}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,extra:1}]})).toBeNull();
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec vitest run --project unit apps/desktop/test/load-status.test.ts apps/desktop/test/ui-message.test.ts`
Expected: FAIL (module missing; `loadStatus` parses to `null`).

- [ ] **Step 3: Implement `load-status.ts`**

```ts
import type {AssetLoadStatus} from '@opensekai/renderer';
import type {UIMessage} from './ui-message';
export function stageLabel(entry:AssetLoadStatus):string{
 if(entry.stage==='download')return 'Downloading';
 if(entry.stage==='textures')return entry.count?`Textures ${entry.count.done} of ${entry.count.total}`:'Textures';
 if(entry.stage==='prepare')return 'Preparing';
 return entry.message??'Load failed';
}
const shape=(entries:AssetLoadStatus[])=>entries.map(entry=>`${entry.entityId}:${entry.assetId}:${entry.stage}`).join('|');
// Stage changes go out at once; progress-only changes go out at most once per interval.
export function createLoadStatusSender(send:(message:UIMessage)=>Promise<void>,intervalMs=200){
 let latest:AssetLoadStatus[]=[],sentShape='',timer:ReturnType<typeof setTimeout>|undefined,closed=false;
 const flush=()=>{timer=undefined;if(closed)return;sentShape=shape(latest);void send({kind:'loadStatus',entries:latest}).catch(()=>{});};
 return {
  offer(entries:AssetLoadStatus[]){
   if(closed)return;latest=entries.slice(0,8);
   if(shape(latest)!==sentShape){if(timer){clearTimeout(timer);}flush();return;}
   timer??=setTimeout(flush,intervalMs);
  },
  resend(){if(timer){clearTimeout(timer);}flush();},
  close(){closed=true;if(timer)clearTimeout(timer);},
 };
}
```

- [ ] **Step 4: Add the `loadStatus` bridge message**

In `apps/desktop/src/editor/ui-message.ts`, import `import type {AssetLoadStatus} from '@opensekai/renderer';`, add `| {kind:'loadStatus';entries:AssetLoadStatus[]}` to `UIMessage`, and add this branch in `parseUIMessage` before the `ready/refresh` branch:

```ts
  if(v.kind==='loadStatus'&&keys(['kind','entries'])&&Array.isArray(v.entries)&&v.entries.length<=8){
   const stages=['download','textures','prepare','failed'];
   const entries=v.entries.map(item=>{
    if(!item||typeof item!=='object')return null;
    const e=item as Record<string,unknown>,allowed=['entityId','assetId','stage','progress','count','message'];
    if(Object.keys(e).some(key=>!allowed.includes(key)))return null;
    if(!IdSchema.safeParse(e.entityId).success||!IdSchema.safeParse(e.assetId).success||!stages.includes(e.stage as string))return null;
    if(!(e.progress===null||(typeof e.progress==='number'&&e.progress>=0&&e.progress<=1)))return null;
    const c=e.count as Record<string,unknown>|undefined;
    if(c!==undefined&&!(c&&typeof c==='object'&&Object.keys(c).length===2&&Number.isInteger(c.done)&&Number.isInteger(c.total)&&(c.done as number)>=0&&(c.done as number)<=(c.total as number)&&(c.total as number)<=1024))return null;
    if(e.message!==undefined&&!(typeof e.message==='string'&&e.message.length<=160))return null;
    return {entityId:e.entityId,assetId:e.assetId,stage:e.stage,progress:e.progress,...(c?{count:{done:c.done,total:c.total}}:{}),...(e.message!==undefined?{message:e.message}:{})} as AssetLoadStatus;
   });
   if(entries.every(entry=>entry!==null))return {kind:'loadStatus',entries:entries as AssetLoadStatus[]};
  }
```

Messages over 4096 bytes are already rejected at the top of the parser; 8 entries stay under that limit.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run --project unit apps/desktop/test/load-status.test.ts apps/desktop/test/ui-message.test.ts`
Expected: PASS.

- [ ] **Step 6: Build the overlay and wire the Scene window**

Create `apps/desktop/src/components/LoadOverlay.svelte`:

```svelte
<script lang="ts">
 import {Button} from '@oshi-connect/ui';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {stageLabel} from '../editor/load-status';
 let {entries,names,ondismiss}:{entries:AssetLoadStatus[];names:Record<string,string>;ondismiss:(entityId:string)=>void}=$props();
</script>
{#if entries.length}
 <div class="load-overlay" role="status" aria-live="polite">
  <div class="load-card">
   {#each entries as entry (entry.entityId)}
    <div class="load-row">
     <div class="load-title">Loading {names[entry.entityId]??entry.assetId}</div>
     <div class="load-stage" class:failed={entry.stage==='failed'}>{stageLabel(entry)}</div>
     {#if entry.stage==='failed'}<Button variant="ghost" onclick={()=>ondismiss(entry.entityId)}>Dismiss</Button>
     {:else}<progress max="1" value={entry.progress??undefined} aria-label={stageLabel(entry)}></progress>{/if}
    </div>
   {/each}
  </div>
 </div>
{/if}
<style>
 .load-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:3}
 .load-card{pointer-events:auto;min-width:260px;max-width:min(360px,80%);display:grid;gap:14px;padding:16px 18px;background:#fafafd;border:1px solid #e3e1e9;border-radius:8px;box-shadow:0 6px 24px #0005}
 .load-row{display:grid;gap:6px}.load-title{font-size:13px;font-weight:600;color:#2b2833}.load-stage{font-size:12px;color:#85818f}.load-stage.failed{color:#b14050}
 progress{width:100%;height:6px;accent-color:#8571ac}
</style>
```

In `apps/desktop/src/bootstrap.ts`, add `onLoadStatus:renderer.onLoadStatus,dismissLoad:renderer.dismissLoad` to the returned object and to the return type (`onLoadStatus(listener:(entries:AssetLoadStatus[])=>void):()=>void;dismissLoad(entityId:string):void;`). Import `type AssetLoadStatus` from `@opensekai/renderer`.

In `apps/desktop/src/App.svelte`:

```ts
 import LoadOverlay from './components/LoadOverlay.svelte';
 import {createLoadStatusSender} from './editor/load-status';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 let loads=$state<AssetLoadStatus[]>([]);
 const names=$derived(Object.fromEntries((view.scene?.entities??[]).map(entity=>[entity.id,entity.name])));
```

Inside `onMount`: create `const loadSender=createLoadStatusSender(message=>sendUI('editor',message));` and `let offLoads=()=>{};`. After `session=value;` add `offLoads=value.onLoadStatus(entries=>{loads=entries;loadSender.offer(entries);});`. In the `listenUI` handler, on `message.kind==='ready'` also call `loadSender.resend();`. In the cleanup function add `offLoads();loadSender.close();`.

In the markup, inside `.preview-surface` after the `.camera-frame` div:

```svelte
<LoadOverlay entries={loads} {names} ondismiss={id=>session?.dismissLoad(id)}/>
```

The overlay is DOM inside `.preview-surface` (already `position:relative`), outside the `<canvas>`, so captures and OBS do not include it.

- [ ] **Step 7: Check and commit**

Run: `pnpm --filter @opensekai/desktop check` — Expected: 0 errors except the `authoring.ts` error from Task 1, which Task 8 removes.
Run: `pnpm exec vitest run --project unit apps/desktop` — Expected: PASS.

```bash
pwd
git add apps/desktop/src/editor/load-status.ts apps/desktop/src/editor/ui-message.ts apps/desktop/src/components/LoadOverlay.svelte apps/desktop/src/App.svelte apps/desktop/src/bootstrap.ts apps/desktop/test/load-status.test.ts apps/desktop/test/ui-message.test.ts
git commit -m "Show model load status over the Scene preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Editor — Add › Character, Model row, status, Resources names

**Files:**
- Modify: `apps/desktop/src/editor/live-fields.ts:4` (`AddKind`)
- Modify: `apps/desktop/src/editor/authoring.ts` (character creation, `modelLabel`; remove `makeImportedAvatar`)
- Modify: `apps/desktop/src/editor/model.ts` (add `setAvatarModel`)
- Create: `apps/desktop/src/components/AvatarModelField.svelte`
- Modify: `apps/desktop/src/components/Hierarchy.svelte`, `Inspector.svelte`, `AssetList.svelte`, `apps/desktop/src/EditorApp.svelte`
- Modify: `apps/desktop/test/authoring.test.ts`, `apps/desktop/test/editor-model.test.ts`

**Interfaces:**
- Consumes: `setAvatarModel` patch (Tasks 1–2), `AssetRecord.name` (Task 1), `UIMessage` `loadStatus` and `stageLabel` (Task 7).
- Produces: `AddKind = 'camera' | 'character' | TrackingConfig['kind']`; `makeAuthoringEntity('character', id, entities)`; `modelLabel(assetId: string | null, assets: readonly AssetRecord[]): string`; `model.setAvatarModel(entityId: Id, assetId: Id | null, expectedRevision?: number): Promise<Reply<{revision: number}>>`.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/test/authoring.test.ts`, change the import to `import {makeEmptyScene,makeAuthoringEntity,modelLabel,importFailure} from '../src/editor/authoring';` and replace the `enables the built-in idle for each imported avatar…` test with:

```ts
it('creates a character without a model and with its own idle settings',()=>{
 const scene=makeEmptyScene();
 const a=makeAuthoringEntity('character','a',scene.entities),b=makeAuthoringEntity('character','b',[...scene.entities,a]);
 expect(SceneEntitySchema.safeParse(a).success).toBe(true);
 expect(a).toMatchObject({kind:'avatar',name:'Character',assetId:null,idleAnimation:{kind:'builtin',enabled:true},tracking:{bodySourceId:null,faceSourceId:null}});
 expect(b.name).toBe('Character 2');
 if(a.kind!=='avatar'||b.kind!=='avatar')throw new Error('avatar expected');
 a.idleAnimation!.enabled=false;a.transform.position[0]=5;expect(b.idleAnimation?.enabled).toBe(true);expect(b.transform.position[0]).toBe(0);
});
it('labels the model control from the asset list',()=>{
 const assets=[{id:'avatar_a',format:'vrm',sha256:'a'.repeat(64),bytes:1,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name:'Rem'}] as const;
 expect(modelLabel(null,assets)).toBe('Choose VRM…');
 expect(modelLabel('avatar_a',assets)).toBe('Rem');
 expect(modelLabel('avatar_gone',assets)).toBe('Missing model');
});
```

Append to `apps/desktop/test/editor-model.test.ts`:

```ts
it('sets or clears an avatar model and rejects non-avatars and bad IDs',async()=>{
 const {model,api}=fixture();await model.load();
 expect((await model.setAvatarModel('performer','avatar_b',0)).ok).toBe(true);
 expect(model.read().scene?.entities.find(e=>e.id==='performer')).toMatchObject({assetId:'avatar_b'});
 expect((await model.setAvatarModel('performer',null,1)).ok).toBe(true);
 expect(await model.setAvatarModel('marker','avatar_b',2)).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(await model.setAvatarModel('performer','',2)).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(api.scenePatch).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec vitest run --project unit apps/desktop/test/authoring.test.ts apps/desktop/test/editor-model.test.ts`
Expected: FAIL (`character` kind unknown; `modelLabel` and `setAvatarModel` missing).

- [ ] **Step 3: Implement authoring and model changes**

`apps/desktop/src/editor/live-fields.ts`:

```ts
export type AddKind='camera'|'character'|TrackingConfig['kind'];
```

`apps/desktop/src/editor/authoring.ts` — replace `makeAuthoringEntity` and `makeImportedAvatar`:

```ts
export function makeAuthoringEntity(kind:AddKind,id:string,entities:readonly SceneEntity[]):SceneEntity {
 const label=({camera:'Camera',character:'Character',vmc:'VMC Receiver',ifacialmocap:'iFacialMocap Receiver',mediapipe:'MediaPipe Tracker'} as const)[kind];
 const count=entities.filter(entity=>kind==='camera'?entity.kind==='camera':kind==='character'?entity.kind==='avatar':entity.kind==='tracking'&&entity.config.kind===kind).length+1;
 const base={id,name:count===1?label:`${label} ${count}`,visible:true,transform:transform()};
 if(kind==='camera')return {...base,kind,transform:{...base.transform,position:[0,1.2,3]},lens:{fovDegrees:40,near:.01,far:100}};
 if(kind==='character')return {...base,kind:'avatar',assetId:null,tracking:{bodySourceId:null,faceSourceId:null},idleAnimation:{kind:'builtin',enabled:true}};
 return {...base,kind:'tracking',generation:0,config:defaultTrackingConfig(kind)};
}
export function modelLabel(assetId:string|null,assets:readonly AssetRecord[]):string {
 if(assetId===null)return 'Choose VRM…';
 return assets.find(asset=>asset.id===assetId)?.name??'Missing model';
}
```

Add `type AssetRecord` to the `@opensekai/contracts` import. Delete `makeImportedAvatar`.

`apps/desktop/src/editor/model.ts` — after `setAvatarTracking`:

```ts
  setAvatarModel(entityId:Id,assetId:Id|null,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=IdSchema.nullable().safeParse(assetId);if(!ofKind(entityId,'avatar')||!parsed.success)return invalid();
   return patch({kind:'setAvatarModel',entityId,assetId:parsed.data},expectedRevision);
  },
```

Import `IdSchema` from `@opensekai/contracts` if it is not imported yet. Add `setAvatarModel` to the model's exported interface or type if one is declared in the file.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run --project unit apps/desktop/test/authoring.test.ts apps/desktop/test/editor-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the Model row**

Create `apps/desktop/src/components/AvatarModelField.svelte`:

```svelte
<script lang="ts">
 import {Button} from '@oshi-connect/ui';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {stageLabel} from '../editor/load-status';
 let {label,status=null,importing=false,disabled=false,onchoose}:{label:string;status?:AssetLoadStatus|null;importing?:boolean;disabled?:boolean;onchoose:()=>void}=$props();
</script>
<div class="model-field">
 <span class="model-label">Model</span>
 <Button variant="secondary" class="model-choice" disabled={disabled||importing} onclick={onchoose}>{label}</Button>
 {#if importing}<div class="model-status"><span>Importing…</span><progress max="1" aria-label="Importing…"></progress></div>
 {:else if status}<div class="model-status" class:failed={status.stage==='failed'}><span>{stageLabel(status)}</span>{#if status.stage!=='failed'}<progress max="1" value={status.progress??undefined} aria-label={stageLabel(status)}></progress>{/if}</div>{/if}
</div>
<style>
 .model-field{display:grid;gap:6px;padding:12px 0;border-bottom:1px solid #e1dee6}.model-label{font-size:12px;color:#85818f}
 .model-field :global(.model-choice){justify-content:flex-start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .model-status{display:grid;gap:4px;font-size:11px;color:#85818f}.model-status.failed{color:#b14050}progress{width:100%;height:5px;accent-color:#8571ac}
</style>
```

- [ ] **Step 6: Wire Inspector, Hierarchy, Resources, and EditorApp**

`Inspector.svelte`: add props `assets:AssetRecord[]=[]`, `loads:AssetLoadStatus[]=[]`, `importingId:string|null=null`, `onchoosemodel?:(id:string)=>void`. Import `AvatarModelField`, `modelLabel`, and the types. In the avatar branch, render before `<AvatarSourceFields …/>`:

```svelte
<AvatarModelField label={modelLabel(entity.assetId,assets)} status={loads.find(load=>load.entityId===entity.id)??null} importing={importingId===entity.id} disabled={view.pending||livePending||disabled||!onchoosemodel} onchoose={()=>onchoosemodel?.(entity.id)}/>
```

`Hierarchy.svelte`:
- Remove the `onimport` prop and the `Import` button.
- Add prop `loading:ReadonlySet<string>=new Set()` and import `Spinner` from `@oshi-connect/ui`.
- Replace the Add button's `actions` expression with this one. It inserts Character after Camera and disables it at the avatar budget, with the existing budget copy:

```ts
actions:([['camera','Camera'],['character','Character'],['vmc','VMC Receiver'],['ifacialmocap','iFacialMocap Receiver'],['mediapipe','MediaPipe Tracker']] as [AddKind,string][]).map(([kind,label])=>{const full=kind==='character'&&(view.scene?.entities.filter(e=>e.kind==='avatar').length??0)>=2;return {label,disabled:full,title:full?'Scene asset limit reached':undefined,run:()=>{if(view.scene?.revision===revision&&!view.pending&&!disabled)void onadd?.(kind,revision);}};})
```
- In the row icon block, put this branch first: `{#if loading.has(entity.id)}<Spinner size="sm" variant="muted" aria-hidden="true"/>{:else if entity.kind==='camera'}…`.

`AssetList.svelte`: show `{asset.name}` in place of `{asset.id}` in the first span.

`EditorApp.svelte`:
- Remove `importAvatar`, `makeImportedAvatar`, and the `onimport` prop on `Hierarchy`.
- Replace `let importing=$state(false)` with `let importingId=$state<string|null>(null);const importing=$derived(importingId!==null);` and `let loads=$state<AssetLoadStatus[]>([]);`.
- Add:

```ts
 async function chooseModel(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_avatar');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   await model.setAvatarModel(entityId,record.id,model.read().scene?.revision);
  }catch(cause){importError=importFailure(cause);}finally{importingId=null;}
 }
```

- In the `listenUI` handler add `else if(message.kind==='loadStatus')loads=message.entries;`.
- Pass `loading={new Set(loads.filter(load=>load.stage!=='failed').map(load=>load.entityId))}` to `Hierarchy`, and `{assets} {loads} {importingId} onchoosemodel={chooseModel}` to `Inspector`.

- [ ] **Step 7: Check and test**

Run: `pnpm check` — Expected: 0 errors in all packages.
Run: `pnpm test:unit` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pwd
git add apps/desktop/src apps/desktop/test
git commit -m "Add characters from the Add menu and choose their model

Remove the separate Import button. The Inspector Model row opens the
VRM picker and shows import and load status. The Resources panel shows
asset names.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Measure the load stall in Safari

**Files:**
- Modify (scratch, not committed): `$SCRATCH/profile/main.ts` where `$SCRATCH=/private/tmp/claude-501/-Users-danirukun-ghq-github-com-oshi-connect-opensekai/1484d6ba-ef4f-4946-b496-6665090a8cdb/scratchpad`. This harness already loads the Rem VRM through `createRenderer` and `createSession`, and posts results to `/result` (appended to `$SCRATCH/profile/results.log`). Its `public/rem.vrm` is a copy of the operator's model.
- Create: `docs/evaluation/character-model-loading.md`

- [ ] **Step 1: Add a `path=add` mode to the harness**

Insert this code in `$SCRATCH/profile/main.ts` **before** the final `try { await (...) }` line, and change that line to call `runAdd()` when `opt.path === 'add'` (`opt.path === 'add' ? runAdd() : opt.path === 'bare' ? runBare() : runReal()`):

```ts
const makeImportedAvatarless = () => ({ id: 'avatar_1', kind: 'avatar', name: 'Rem', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tracking: { bodySourceId: null, faceSourceId: null }, idleAnimation: { kind: 'builtin', enabled: true } });
async function runAdd() {
  const live = createSession(makeEmptyScene(), 'session_add');
  const renderer = await createRenderer({ canvas, outputId: 'output_main', mode: 'auto', resources, diagnostics: false, resolutionScale: opt.scale as 1 | 0.5 });
  let loading = false, loaded = false;
  renderer.onLoadStatus((entries: unknown[]) => { if (entries.length) loading = true; else if (loading) loaded = true; });
  const before: number[] = [], during: number[] = [], after: number[] = [];
  let last = await raf(); const t0 = last;
  for (let i = 0; i < 900 && !(loaded && after.length >= 120); i++) {
    const now = await raf();
    if (i === 120) live.applyPatch({ sceneId: 'scene_smoke', expectedRevision: live.inspect().revision, operations: [{ kind: 'createEntity', entity: { ...makeImportedAvatarless(), assetId: 'asset_rem' } }] } as never);
    await renderer.applyFrame(live.advance(now - t0, now));
    (i < 120 ? before : loaded ? after : during).push(now - last);
    last = now;
  }
  const over = (xs: number[], ms: number) => xs.filter(x => x > ms).length;
  log('RESULT', { path: 'add', before: stats(before), during: { ...stats(during), over33: over(during, 33), over100: over(during, 100) }, after: stats(after) });
  renderer.dispose();
}
```

- [ ] **Step 2: Run in Safari, cold and warm**

Start the harness server from `packages/renderer` (`pnpm exec vite --config $SCRATCH/profile/vite.config.mjs`, run in background). Then:

```bash
: > $SCRATCH/profile/results.log
open -a Safari "http://localhost:5199/?path=add"
```

Wait until `results.log` has a `RESULT` line. Run it again (warm cache). For a cold run, quit Safari first (`osascript -e 'quit app "Safari"'`) only if the operator agrees; otherwise record that the cold case is unknown. Close the harness tabs and stop the server afterwards.

- [ ] **Step 3: Record the evidence**

Create `docs/evaluation/character-model-loading.md` (ASD-STE100). Give: date, commit, Safari version, frame interval statistics before, during, and after the load, the number of frames over 33 ms and over 100 ms during the load, and the load duration. Write a conclusion that states exactly what the numbers show. If frames over 100 ms remain, record them as a residual risk and name the probable stage (texture upload or pipeline creation); do not claim that the stall is gone.

- [ ] **Step 4: Commit**

```bash
pwd
git add docs/evaluation/character-model-loading.md
git commit -m "Record model load frame timing in Safari

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Live macOS verification, parity, and evidence

**Files:**
- Modify: `docs/evaluation/character-model-loading.md`, `docs/evaluation/scene-performance-monitor.md`, `docs/warudo-parity.md`

This task needs the operator. A release instance of OpenSekai may be running with unsaved edits. **Ask the operator before you quit it.**

- [ ] **Step 1: Build and start**

Run: `pnpm check && pnpm test:unit && pnpm test:integration && cargo test --workspace` — Expected: all PASS.
After the operator agrees, quit the running instance and run `pnpm dev:desktop` (background).

- [ ] **Step 2: Verify the flows (computer-use on the running app)**

1. Assets › Add shows `Character` after `Camera`; there is no Import button.
2. Add › Character creates `Character`; the Model row shows `Choose VRM…`; the Scene shows no placeholder.
3. Choose `RemModel VRM0 (1).vrm` from `~/Library/Mobile Documents/com~apple~CloudDocs/VTuber Avatars/`. The Model row shows `Importing…`, then the Scene overlay shows `Loading Character` with `Downloading`, `Textures n of 24`, and `Preparing`, and the editor Model row and Assets row spinner mirror it. The Scene preview keeps moving during the load (watch the camera frame or another object; turn on the performance monitor).
4. With the monitor on and Rem loaded, the monitor shows more than 15 FPS (preview pump change from commit `3e417bb`).
5. Choose a second VRM for the same character. The old model stays visible until the new one appears.
6. Save the show, open it again, and check that the Model row shows the model name.
7. Edit the saved show file so that the asset ID does not exist, open it, and check `Missing model` in the Model row, a failed row in the overlay, and that **Dismiss** removes it.
8. Check the OBS browser source (ws://127.0.0.1:4455, isolated OpenSekai test source): it keeps rendering during a load and has no overlay. Take a local screenshot. Do not start a stream.

- [ ] **Step 3: Record evidence and parity**

Add the live results and screenshots to `docs/evaluation/character-model-loading.md`. In `docs/evaluation/scene-performance-monitor.md`, record the observed preview FPS with Rem. In `docs/warudo-parity.md`, update UI-11 if the toggle and OBS isolation were verified, and add a line for characters as assets with a Model field and load status, claiming only what Step 2 showed.

- [ ] **Step 4: Commit**

```bash
pwd
git add docs
git commit -m "Record character model and load status checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
