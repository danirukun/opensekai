# Chat Slice 1 — Thin Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a small model a few strict intent tools that compile in code to one atomic scene and Blueprint change, and expose them through MCP.

**Architecture:** A new call `proposalApply` applies scene ops, one Blueprint batch, and the output camera as one unit, with a conflict check scoped to the entities and graphs it touches. A new pure package `@opensekai/assist` holds the intent schemas, the word tables, the reference table, the scene summary, and the compiler. The MCP server registers one tool per intent that compiles and calls `proposalApply`.

**Tech Stack:** TypeScript, zod 4.6.5, vitest, Rust (`crates/contracts`, Tauri host), MCP SDK 2.3.0.

**Spec:** `spdd/prompt/2026-11-08-chat-thin-tools.md` (R1–R17). Analysis: `spdd/analysis/2026-11-08-chat-thin-tools.md`. Design: `docs/superpowers/specs/2026-11-07-opensekai-chat-design.md`. Dependency plan: `docs/superpowers/plans/2026-11-08-opensekai-chat-dependency-plan.md`. Read the REASONS contract before each task.

## Global Constraints

- `proposalApply` limits: `sceneOps` 0–64, `blueprint` one batch (1–64 ops) or `null`, `expect.entities` ≤ 64, `expect.blueprints` ≤ 16, at least one change.
- Conflict reply: code `CONFLICT`, message `Proposal target changed`, `ids` = every failed expectation ID.
- `fingerprint`: FNV-1a 64-bit over canonical JSON (sorted keys), 16 lower-case hex characters.
- `TOOL_CONTRACT_VERSION = 1`. At most 8 Blueprints in a show (`BlueprintSetSchema`); each camera move uses one. Orbit step ≤ 15°. Summary lists ≤ 12 assets. Blueprint actions 1–8. Prop count 1–8.
- Catalog: `description` 1–280 UTF-16 units, `tags` ≤ 8, each 1–32 units, lower case.
- New IDs: `chat_<kind>_<suffix>` from the injected `newId`. References: `@e<n>`, `@b<n>`, `@a<n>`, never reused.
- `packages/assist` imports only `@opensekai/contracts` and `zod`. No Node built-ins, no Svelte.
- No change to existing MCP tools, the editor UI, the renderer, the OBS page, or the show format.
- pnpm only. Functional TypeScript, plain data, the dense style of `packages/contracts`. Comments only where logic is hard to follow.
- Prose (docs, evidence, commit bodies) in ASD-STE100. No agent attribution in commits. Run commands from the worktree root; no `git -C`, no `cd … &&`.

## Review Focus

1. **Gizmo drag on a touched entity during Accept.** The operator moves the key light after the proposal is made; `proposalApply` must fail with `CONFLICT` and that ID, and change nothing. A drag on another entity must not block it. Test: Task 2 `conflict is scoped to touched entities`.
2. **Stale reference.** The model uses `@e3` after that entity was removed. Expect `INVALID_INPUT` with `ids: ['@e3']`, not a throw. Test: Task 5 `rejects a reference to a removed entity`.
3. **Orbit angle not a multiple of 15, and a full 360° loop.** 100° gives 7 equal steps; 360° with `loop` has no duplicate end point; step times add up to the duration word. Test: Task 6 `orbit steps`.
4. **Japanese prompt.** `ステージ` must rank an asset tagged `ステージ` first; ranking uses substring match, not word splitting. Test: Task 4 `ranks assets for a Japanese prompt`.
5. **Blueprint batch fails after valid scene ops.** For example a `createGraph` with an ID that exists. The scene revision and entities must stay the same. Test: Task 2 `a failed batch leaves the scene unchanged`.

---

### Task 1: `proposalApply` contract and Rust mirror (integrator)

**Files:**
- Create: `packages/contracts/src/fingerprint.ts`, `packages/contracts/src/proposal.ts`, `packages/contracts/test/proposal.test.ts`, `crates/contracts/tests/proposal.rs`
- Modify: `packages/contracts/src/index.ts`, `schema.ts` (`ParamSchemas`, `ResultSchemas`, the method list near line 572, `requiredCapability`), `types.ts` (`AppApi`)
- Modify: `crates/contracts/src/lib.rs` (`validate_call`, `validate_result`, the known-method list near line 2485; move the op loop of `impl Validate for ScenePatch` into `fn validate_patch_ops(ops: &[PatchOp], max: usize)`)
- Modify: `apps/desktop/src-tauri/src/service/router.rs` (lines ~210, ~282, ~392, and the keystroke learning at ~241)
- Modify: `fixtures/protocol/validation-vectors.json`, `ARCHITECTURE.md` (Command path)

**Interfaces:**
- Produces: `fingerprint(value: unknown): string`; `ProposalApplyParamsSchema`, `ProposalApplyResultSchema`; types `ProposalApplyParams`, `ProposalApplyResult`, `Expectation = {id: Id; fingerprint: string | null}`; `AppApi.proposalApply(params: ProposalApplyParams): Promise<Reply<ProposalApplyResult>>`; `PROPOSAL_LIMITS = {sceneOps: 64, entities: 64, blueprints: 16}`.
- Produces (Rust): `ProposalApplyParams`, `ProposalApplyResult { revision: u64, blueprint: Option<BlueprintEditResult> }`, `validate_patch_ops`.

- [ ] **Step 1: Write the failing TypeScript tests**

```ts
it('fingerprint ignores key order and changes with values', () => {
 expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
 expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
 expect(fingerprint({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
});
it('validates proposalApply limits', () => {
 const ok = { sceneId: 's', expect: { entities: [], blueprints: [] }, sceneOps: [], blueprint: null, output: { outputId: 'o', cameraId: 'c' } };
 expect(validateCall('proposalApply', ok).ok).toBe(true);
 expect(validateCall('proposalApply', { ...ok, output: null }).ok).toBe(false); // no change
 expect(validateCall('proposalApply', { ...ok, sceneOps: Array(65).fill({ kind: 'removeEntity', entityId: 'x' }) }).ok).toBe(false);
 expect(validateCall('proposalApply', { ...ok, expect: { entities: Array(65).fill({ id: 'x', fingerprint: null }), blueprints: [] } }).ok).toBe(false);
 expect(validateCall('proposalApply', { ...ok, expect: { entities: [{ id: 'x', fingerprint: 'ABC' }], blueprints: [] } }).ok).toBe(false);
 expect(requiredCapability('proposalApply')).toBe('edit');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --project unit packages/contracts/test/proposal.test.ts`
Expected: FAIL, `fingerprint` is not exported.

- [ ] **Step 3: Implement the TypeScript contract**

`fingerprint.ts`: canonical JSON (recursive, `Object.keys(...).sort()`), then FNV-1a 64 with `BigInt` (offset `0xcbf29ce484222325n`, prime `0x100000001b3n`, mask to 64 bits) over the UTF-8 bytes from `TextEncoder`. `proposal.ts`: schemas per the Interfaces block, with a `.refine` for "at least one change"; `blueprint` reuses `BlueprintBatchSchema`; result `blueprint` reuses the `blueprintEdit` result schema. Wire the method into `ParamSchemas`, `ResultSchemas`, the method list, `requiredCapability` (edit), and `AppApi`.

- [ ] **Step 4: Add vectors and the Rust mirror**

Vectors (target `call`, method `proposalApply`): one valid call with each part, the empty-change call, 65 scene ops, 65 entity expectations, 17 Blueprint expectations, a bad fingerprint, an invalid scene op inside `sceneOps` (`setLight` with color `orange`). One `reply` vector with a `blueprint` result.

Rust test `crates/contracts/tests/proposal.rs`:

```rust
#[test]
fn proposal_apply_matches_the_typescript_rules() {
    let ok = json!({"sceneId":"s","expect":{"entities":[{"id":"a","fingerprint":"0123456789abcdef"}],"blueprints":[]},"sceneOps":[],"blueprint":null,"output":{"outputId":"o","cameraId":"c"}});
    assert!(validate_call("proposalApply", &ok).is_ok());
    let mut empty = ok.clone(); empty["output"] = Value::Null;
    assert!(validate_call("proposalApply", &empty).is_err());
}
```

`ScenePatch::validate` calls `validate_patch_ops(&self.operations, 32)`; `ProposalApplyParams::validate` calls it with 64 (and allows 0).

- [ ] **Step 5: Router**

Add `"proposalApply"` to the edit capability match, to both scene relay lists, and learn keystrokes when `method == "proposalApply"` from `result.data.blueprint` with the same code as `blueprintEdit` (extract one helper `learn_from(&self, publisher_id, BlueprintEditResult)`).

- [ ] **Step 6: Run both sides**

Run: `pnpm vitest run --project unit packages/contracts` then `cargo test -p opensekai-contracts` then `cargo test -p opensekai-desktop router`
Expected: PASS, including `vectors.rs` and `schema.test.ts`.

- [ ] **Step 7: ARCHITECTURE.md and commit**

Command path: one paragraph on `proposalApply` (all or nothing, scoped fingerprint check, relays like `scenePatch`, router learns keystrokes from `blueprint`).

```bash
git add packages/contracts crates/contracts apps/desktop/src-tauri/src/service/router.rs fixtures/protocol/validation-vectors.json ARCHITECTURE.md
git commit -m "Add the proposalApply contract with a scoped conflict check"
```

### Task 2: Session `applyProposal`

**Files:**
- Modify: `packages/session/src/session.ts` (interface at ~line 22, implementation next to `applyPatch` ~line 336), `packages/session/src/session-api.ts` (`SESSION_METHODS`, `sessionApi`)
- Test: `packages/session/test/proposal-apply.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and `fingerprint`.
- Produces: `Session.applyProposal(params: unknown): Reply<ProposalApplyResult>`; `sessionApi(session).proposalApply`.

- [ ] **Step 1: Write the failing tests** (use the session factory as `light-patch.test.ts` does)

```ts
it('applies scene ops, a Blueprint batch, and the output camera as one change', ...)
 // create camera + createGraph + output → ok; revision +1; output.cameraId is the new camera; graph exists
it('conflict is scoped to touched entities', ...)
 // fp = fingerprint(light); scenePatch setTransform on another entity → proposalApply with expect light fp → ok
 // scenePatch setTransform on the light → proposalApply → {ok:false, error:{code:'CONFLICT', message:'Proposal target changed', ids:['light']}}
it('fails when an expected-absent ID exists', ...) // expect {id:'performer', fingerprint:null} → CONFLICT ['performer']
it('a failed batch leaves the scene unchanged', ...)
 // valid createEntity + createGraph with an existing graph ID → not ok; inspect().revision and entities unchanged; inspectBlueprints unchanged
it('a failed scene op leaves the Blueprints unchanged', ...) // ninth light → INVALID_INPUT; blueprint revision unchanged
it('rejects an output camera that is not a camera', ...) // NOT_FOUND / INVALID_INPUT like selectCamera
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm vitest run --project unit packages/session/test/proposal-apply.test.ts`
Expected: FAIL, `applyProposal` is not a function.

- [ ] **Step 3: Implement `applyProposal`**

Order (comment it in the code): parse → scene ID → every expectation (collect all failed IDs, entity fingerprint from `persistent.entities`, graph fingerprint from the store's active graph) → `resolveCalibrations` + `applyOperations` on the scene ops (skip when empty) → output camera on the copy with the `selectCamera` checks → revision overflow check → `api.editBlueprints(batch)` when present (return its failure as is) → `commit` → drop overrides and tweens as `applyPatch` does. Result `{revision, blueprint: batchReply.data | null}`.

- [ ] **Step 4: Run and pass**

Run: `pnpm vitest run --project unit packages/session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session
git commit -m "Apply a Chat proposal in the session as one change"
```

### Task 3: `@opensekai/assist` intents and words

**Files:**
- Create: `packages/assist/package.json` (name `@opensekai/assist`, deps `@opensekai/contracts: workspace:*`, `zod: 4.6.5`, `check` script as in `packages/contracts`), `packages/assist/tsconfig.json` (as `packages/session`), `src/index.ts`, `src/intents.ts`, `src/words.ts`
- Test: `packages/assist/test/intents.test.ts`, `packages/assist/test/words.test.ts`
- Modify: `pnpm-lock.yaml` (through `pnpm install`)

**Interfaces:**
- Produces: `TOOL_CONTRACT_VERSION = 1`; `RefSchema` (`/^@[eba][1-9][0-9]{0,4}$/`); enums `DirectionSchema` (`front`, `frontLeft`, `left`, `backLeft`, `back`, `backRight`, `right`, `frontRight`, `above`), `HeightSchema` (`low`, `eye`, `high`), `ColorWordSchema` (`candle`, `warm`, `neutral`, `daylight`, `cool`, `white`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`), `IntensitySchema` (`dim`, `soft`, `normal`, `bright`), `FramingSchema` (`wide`, `medium`, `closeUp`, `extremeCloseUp`), `DurationSchema` (`quick`, `normal`, `slow`, `verySlow`), `EasingWordSchema` (`smooth`, `linear`, `easeIn`, `easeOut`), `HazeDensitySchema` (`off`, `light`, `medium`, `thick`), `ReflectionsSchema` (`off`, `low`, `normal`, `high`), `WaitSchema` (`short`, `medium`, `long`).
- Produces: `IntentSchemas: Record<IntentTool, ZodObject>` and `IntentSchema` (discriminated on `tool`) with these fields (all optional unless marked):
  - `light_setup`: `role`* (`key`|`fill`|`rim`|`ambient`), `target`, `direction`, `height`, `color`, `intensity`, `shadow` (boolean), `name` (1–64), `replace`
  - `camera_add`: `framing`*, `target`, `side` (direction without `above`), `height`, `name`
  - `camera_move`: `camera`*, `kind`* (`orbit`|`dolly`|`pushIn`|`pullOut`|`crane`), `target`, `angleDegrees` (int 15–360, orbit only), `turn` (`left`|`right`, orbit), `rise` (`up`|`down`, crane), `duration`, `easing`, `endFraming`, `loop` (boolean), `name`
  - `environment_set`: `asset`*, `reflections`
  - `prop_place`: `asset`*, `near`, `relation` (`front`|`behind`|`left`|`right`|`around`), `count` (int 1–8), `name`
  - `haze_set`: `density`*
  - `output_camera`: `camera`*
  - `blueprint_build`: `name`*, `trigger`*, `actions`* (1–8), `replace` — trigger union `{kind:'hotkey', key (accelerator 1–64)}` | `{kind:'manual'}` | `{kind:'event', name (1–64)}` | `{kind:'youtube', event: 'chat'|'superChat'|'superSticker'|'newMember'|'memberMilestone'}` | `{kind:'showStart'}`; action union `{kind:'expression', character, expression (1–64), mode: 'on'|'off'|'toggle'}` | `{kind:'visibility', entity, mode: 'show'|'hide'|'toggle'}` | `{kind:'switchCamera', camera}` | `{kind:'wait', length: WaitSchema}` | `{kind:'emit', name}`
  - `ask`: `question`* (1–200), `choices`* (2–5 strings, 1–64)
  - `look_up`: `ref`*
- Produces (`words.ts`): `WORDS = {intensity: Record<Intensity, Record<LightType, number>>, color: Record<ColorWord, string>, framing: Record<Framing, {distance: number, fovDegrees: number, aimHeight: number}>, height: Record<Height, number>, duration: Record<Duration, number>, easing: Record<EasingWord, Easing>, haze: Record<HazeDensity, HazeSettings>, reflections: Record<Reflections, number>, wait: Record<Wait, number>, direction: Record<Direction, Vec3>}`. Values are the builder's choice inside the contract ranges (`LightSettingsSchema`, `HazeSettingsSchema`, `ReflectionsIntensitySchema`, `EASINGS`).

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts a full light intent and rejects hex, seconds, and raw IDs', () => {
 expect(IntentSchema.safeParse({ tool: 'light_setup', role: 'key', target: '@e1', direction: 'frontLeft', color: 'purple', intensity: 'bright' }).success).toBe(true);
 expect(IntentSchema.safeParse({ tool: 'light_setup', role: 'key', color: '#ff00ff' }).success).toBe(false);
 expect(IntentSchema.safeParse({ tool: 'camera_move', camera: '@e2', kind: 'orbit', duration: 4 }).success).toBe(false);
 expect(IntentSchema.safeParse({ tool: 'output_camera', camera: 'camera_main' }).success).toBe(false);
 expect(IntentSchema.safeParse({ tool: 'light_setup', role: 'key', extra: 1 }).success).toBe(false);
});
it('limits blueprint actions to 1–8 and ask choices to 2–5', ...)
it('word values keep their order and stay inside the contract ranges', () => {
 const order = <K extends string>(t: Record<K, number>, keys: K[]) => keys.every((k, i) => i === 0 || t[keys[i - 1]!] < t[k]);
 expect(order(WORDS.duration, ['quick', 'normal', 'slow', 'verySlow'])).toBe(true);
 expect(order(Object.fromEntries(Object.entries(WORDS.framing).map(([k, v]) => [k, v.distance])) as Record<Framing, number>, ['extremeCloseUp', 'closeUp', 'medium', 'wide'])).toBe(true);
 expect(WORDS.haze.off.density).toBe(0);
 for (const s of Object.values(WORDS.haze)) expect(HazeSettingsSchema.safeParse(s).success).toBe(true);
 for (const c of Object.values(WORDS.color)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
 // intensity order per light type, height order, temperature words warm → cool (red channel falls, blue rises)
});
```

- [ ] **Step 2: Run and see them fail** — `pnpm vitest run --project unit packages/assist` → FAIL, module not found.

- [ ] **Step 3: Implement `intents.ts` and `words.ts`, export from `index.ts`, run `pnpm install`**

- [ ] **Step 4: Run and pass** — same command, then `pnpm --filter @opensekai/assist check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/assist pnpm-lock.yaml
git commit -m "Add the Chat intent schemas and word tables"
```

### Task 4: References, scene summary, and look up

**Files:**
- Create: `packages/assist/src/refs.ts`, `packages/assist/src/summary.ts`
- Test: `packages/assist/test/refs.test.ts`, `packages/assist/test/summary.test.ts`

**Interfaces:**
- Consumes: `RefSchema` (Task 3); `SceneView`, `BlueprintGraph`, `AssetSummary` (contracts; `catalog` arrives in Task 7 — read it as optional).
- Produces: `type RefTable` (REASONS E); `emptyRefs(): RefTable`; `assignRefs(table: RefTable, ids: {entities: Id[], blueprints: Id[], assets: Id[]}): RefTable`; `resolveRef(table: RefTable, ref: string): {kind: 'entity'|'blueprint'|'asset', id: Id} | null`; `refOf(table, kind, id): Ref`; `sceneSummary(input: {scene: SceneView, blueprints: BlueprintGraph[], assets: AssetSummary[], refs: RefTable, selection: Id | null, prompt?: string}): {text: string, refs: RefTable}`; `lookUp(input: same minus prompt, ref: string): Reply<string>`; `SUMMARY_ASSETS = 12`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps references stable and never reuses one', () => {
 const a = assignRefs(emptyRefs(), { entities: ['x', 'y'], blueprints: [], assets: [] });
 const b = assignRefs(a, { entities: ['y', 'z'], blueprints: [], assets: [] }); // x removed, z new
 expect(refOf(b, 'entity', 'y')).toBe('@e2');
 expect(refOf(b, 'entity', 'z')).toBe('@e3');
 expect(resolveRef(b, '@e1')).toEqual({ kind: 'entity', id: 'x' }); // the table keeps x; the compiler checks the scene
});
it('summarizes without transforms or light values', () => {
 const { text } = sceneSummary({ scene: smokeScene, blueprints: [], assets: [], refs: emptyRefs(), selection: 'performer' });
 expect(text).toMatch(/^@e\d+ .+ · avatar$/m);
 expect(text).toMatch(/^selection @e\d+$/m);
 expect(text).not.toMatch(/position|intensity|#[0-9a-f]{6}/);
});
it('lists at most 12 assets ranked by the prompt', ...) // 20 assets; 'beach palm' prompt → palm-tagged asset first
it('ranks assets for a Japanese prompt', ...) // tags ['ステージ'] ranks first for 'ステージを紫に'
it('looks up a light and a Blueprint', ...) // light text has type, color, intensity; graph text has node type counts
it('look up of an unknown reference fails', ...) // {ok:false, error:{code:'NOT_FOUND', ids:['@e99']}}
```

Use `fixtures/protocol/valid-scene.json` as `smokeScene`.

- [ ] **Step 2: Run and see them fail** — `pnpm vitest run --project unit packages/assist/test/refs.test.ts packages/assist/test/summary.test.ts`

- [ ] **Step 3: Implement**

Ranking: score = number of the asset's tags, name words, and description words (lower case) that occur as substrings of the lower-case prompt; ties by name. Assets already used by a scene entity come first. The summary assigns references for every ID it lists and returns the new table.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit** — `git add packages/assist && git commit -m "Add Chat references, scene summary, and look up"`

### Task 5: Scene compiler

**Files:**
- Create: `packages/assist/src/aim.ts`, `packages/assist/src/compile.ts`, `packages/assist/src/compile-scene.ts`
- Test: `packages/assist/test/aim.test.ts`, `packages/assist/test/compile-scene.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: `lookAt(from: Vec3, to: Vec3): Quat` and `eulerDegrees(q: Quat): Vec3` (YXZ, matching `property-registry.ts`); `type CompileContext`, `type Proposal`, `type Note` (REASONS E); `compileIntents(intents: Intent[], context: CompileContext): Reply<Proposal>`; `targetPoint(entity: SceneEntity, framing?: Framing): Vec3`. `compileIntents` dispatches `camera_move` and `blueprint_build` to Task 6 functions through a `Record<IntentTool, Compiler>` table; in this task those two entries return `INVALID_INPUT` "not available".
- Internal compiler signature (Task 6 uses it): `type Compiler = (intent: Intent, state: WorkingState, context: CompileContext) => Reply<WorkingState>`, `WorkingState = {scene: SceneView, blueprints: BlueprintGraph[], proposal: Proposal}`. Each compiler adds ops to `proposal` and updates the working copies. `packages/assist` cannot import the session, so `applyToWorking(scene: SceneView, op: PatchOp): SceneView` in `compile.ts` handles only the op kinds this compiler emits (`createEntity`, `setLight`, `setTransform`, `setEnvironmentModel`, `setEnvironmentReflections`, `setHaze`). Working Blueprints use `applyBlueprintOps` from contracts.

- [ ] **Step 1: Write the failing tests**

```ts
const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({ scene: smokeScene, blueprints: [], assets, refs: summaryRefs, selection: null, newId: seqIds(), ...over });
it('compiles a three-point light around the selected avatar', () => {
 const r = compileIntents([{ tool: 'light_setup', role: 'key' }, { tool: 'light_setup', role: 'fill' }, { tool: 'light_setup', role: 'rim' }], ctx({ selection: 'performer' }));
 expect(r.ok && r.data.sceneOps.filter(o => o.kind === 'createEntity')).toHaveLength(3);
 // every light passes LightSettingsSchema; key is left-front of the avatar; rim is behind; each aims at the avatar
});
it('gives a key light no shadow when both shadow slots are used', ...) // notes contains {code:'shadowSkipped'}
it('fails at the light limit with a message that names it', ...) // 8 lights → INVALID_INPUT /lights/
it('rejects a reference to a removed entity', ...) // refs has @e3 for an ID not in scene → {ok:false, error:{code:'INVALID_INPUT', ids:['@e3']}}
it('rejects a reference of the wrong kind', ...) // output_camera camera:'@e1' (avatar) → INVALID_INPUT ['@e1']
it('a later intent uses a camera that an earlier intent created', ...) // camera_add then output_camera with the new ref from proposal.refs
it('replaces an existing light in place', ...) // replace:'@e3' → setLight + setTransform on that ID, touched includes it, note replacedExisting
it('sets the environment model on the existing environment or creates one', ...)
it('places 3 props around a reference and clamps nothing below 8', ...) // count 3 → 3 createEntity with distinct positions
it('turns haze off with density 0', ...)
it('defaults the target to the first avatar and notes it', ...) // selection null → note targetDefaulted
```

`aim.test.ts`: `lookAt([0,0,5],[0,0,0])` gives the identity camera orientation for a camera that looks down −Z; `eulerDegrees` round-trips with `quaternionFromEuler`.

Created IDs in the test context come from `seqIds()` (`chat_light_1`, …), so assertions are exact.

- [ ] **Step 2: Run and see them fail**

- [ ] **Step 3: Implement**

Light placement: position = target point + `WORDS.direction[direction] × distance(role)` + `WORDS.height[height]`; rotation = `lookAt(position, target)`. Default direction by role: key `frontLeft`, fill `frontRight`, rim `backRight`, ambient none (ambient ignores position). Type: key, fill, rim `spot` with a cone; ambient `ambient`. Created light names default to the role (`Key light`, `Fill light`, `Rim light`, `Ambient light`) when `name` is absent. Camera placement uses `WORDS.framing` (distance, field of view, aim height) and `side`. Each created ID goes into `created` and `refs`; each changed existing ID goes into `touched`.

- [ ] **Step 4: Run and pass**

- [ ] **Step 5: Commit** — `git add packages/assist && git commit -m "Compile Chat scene intents to scene operations"`

### Task 6: Camera move, Blueprint build, and apply params

**Files:**
- Create: `packages/assist/src/camera-move.ts`, `packages/assist/src/blueprint-build.ts`, `packages/assist/src/apply-params.ts`
- Modify: `packages/assist/src/compile.ts` (the two table entries)
- Test: `packages/assist/test/camera-move.test.ts`, `packages/assist/test/blueprint-build.test.ts`, `packages/assist/test/apply-params.test.ts`

**Interfaces:**
- Consumes: `Compiler`, `WorkingState`, `lookAt`, `eulerDegrees`, `targetPoint` (Task 5); `BlueprintGraphSchema`, `BlueprintSetSchema` (at most 8 graphs), `applyBlueprintOps` (contracts).
- Produces: `orbitSteps(angleDegrees: number): number[]` (cumulative angles, each step ≤ 15°, equal steps); `compileCameraMove: Compiler`; `compileBlueprintBuild: Compiler`; `toApplyParams(proposal: Proposal, context: CompileContext, batch: {clientId: Id, batchId: Id}, outputId?: Id): ProposalApplyParams`.

- [ ] **Step 1: Write the failing tests**

```ts
it('orbit steps', () => {
 expect(orbitSteps(90)).toEqual([15, 30, 45, 60, 75, 90]);
 expect(orbitSteps(100)).toHaveLength(7);
 expect(orbitSteps(100).at(-1)).toBeCloseTo(100);
 expect(orbitSteps(360)).toHaveLength(24);
});
it('compiles an orbit with push-in to a Play chain', () => {
 const r = compileIntents([{ tool: 'camera_move', camera: '@e2', target: '@e1', kind: 'orbit', angleDegrees: 90, duration: 'slow', endFraming: 'closeUp' }], ctx());
 const graph = (r.ok && r.data.blueprintOps[0]?.kind === 'createGraph') ? r.data.blueprintOps[0].graph : null;
 expect(BlueprintGraphSchema.safeParse(graph).success).toBe(true);
 expect(graph!.nodes.filter(n => n.type === 'event.manual')).toHaveLength(1);
 expect(graph!.nodes.some(n => n.type === 'event.enable')).toBe(false);
 // 6 position steps + 6 rotation steps + 1 fovDegrees; transitionSeconds of the position chain sum to WORDS.duration.slow
 // each step's rotation faces the target (angle between forward vector and target direction < 1°)
 expect(r.ok && r.data.play).toEqual([{ graphId: graph!.id, nodeId: expect.any(String) }]);
});
it('a full loop has no duplicate end point and wires back to the start', ...) // 360 + loop → last transitionEnd → first step
it('dolly and push-in are one straight step', ...)
it('builds a Super Chat to heart expression Blueprint', ...)
 // trigger youtube superChat + expression on → graph passes the contracts graph validation; graph ID in created.blueprints and refs.owned
it('replaces only an owned Blueprint', ...) // replace '@b1' not owned → INVALID_INPUT ['@b1']; owned → removeGraph then createGraph with the same graph ID in one batch, and touched.blueprints has that ID
it('fails at the Blueprint limit with a message that names it', ...) // 8 graphs → camera_move and blueprint_build give INVALID_INPUT /Blueprints/
it('apply params expect current fingerprints and absent created IDs', () => {
 // touched light → {id, fingerprint: fingerprint(entity)}; created camera → {id, fingerprint: null}; created graph → blueprints [{id, fingerprint: null}]
 // output proposal → output {outputId: scene.outputs[0].id, cameraId}
});
```

- [ ] **Step 2: Run and see them fail**

- [ ] **Step 3: Implement**

Node IDs inside a graph are deterministic (`play`, `step_1`, …). Each step sets `position` and `rotation` with the same `transitionSeconds` and easing; the `position` node's `exit` port goes to the `rotation` node and its `transitionEnd` port goes to the next step (the Camera Sway pattern). The `fovDegrees` node joins the last step. Hotkey trigger: `event.keystroke`; manual: `event.manual`; event: `event.custom`; YouTube: `youtube.<event>`; show start: `event.enable`. Actions map to `character.setExpression` / `character.toggleExpression`, `scene.setVisibility` / `scene.toggleVisibility`, `camera.switch`, `flow.delay`, `event.emit`; read each node definition in `packages/contracts/src/blueprint-nodes/` for its ports and settings. Apply the batch to the working Blueprints with `applyBlueprintOps` and check the result with `BlueprintSetSchema` before return.

- [ ] **Step 4: Run and pass** — `pnpm vitest run --project unit packages/assist` and `pnpm --filter @opensekai/assist check`.

- [ ] **Step 5: Commit** — `git add packages/assist && git commit -m "Compile Chat camera moves and Blueprints, and build apply params"`

### Task 7: Asset catalog from glTF extras

Independent of Tasks 3–6; it can run in a parallel worktree after Task 1.

**Files:**
- Modify: `packages/contracts/src/schema.ts` (`AssetRecordSchema`, `AssetSummarySchema`), `types.ts` (`AssetCatalog`, optional `catalog` on `AssetRecord` and `AssetSummary`), `crates/contracts/src/lib.rs` (`AssetCatalog` object, optional field on `AssetRecord` and `AssetSummary`, `AssetSummary::of`, a `catalog_ok` next to `credits_ok`)
- Modify: `apps/desktop/src-tauri/src/assets/scene_import.rs` (`read_catalog` next to `read_credits`; set it where the record is built), `registry.rs` only if the record is built there
- Modify: `fixtures/protocol/validation-vectors.json`
- Test: `crates/contracts/tests/asset_catalog.rs`, unit tests in `scene_import.rs` next to the `read_credits` tests, `packages/contracts/test/asset-management.test.ts`

**Interfaces:**
- Produces: `AssetCatalog = {description: string | null; tags: string[]}`; `read_catalog(json: &Value) -> Option<AssetCatalog>` (None when both are empty).

- [ ] **Step 1: Write the failing Rust tests**

```rust
#[test]
fn reads_description_and_tags_from_extras() {
    let json = json!({"asset":{"extras":{"description":"  Palm tree for a beach ","tags":["Palm"," beach ","", 3, "x".repeat(33)]}}});
    assert_eq!(read_catalog(&json), Some(AssetCatalog { description: Some("Palm tree for a beach".into()), tags: vec!["palm".into(), "beach".into()] }));
    assert_eq!(read_catalog(&json!({"asset":{}})), None);
}
```

Plus vectors (target `asset` and `assetList`): a valid catalog, 9 tags, a 281-unit description, an upper-case tag.

- [ ] **Step 2: Run and see them fail** — `cargo test -p opensekai-desktop read_catalog` and `cargo test -p opensekai-contracts`

- [ ] **Step 3: Implement both sides** — tags: trim, lower case, drop empty, non-string, or over 32 units, keep the first 8, remove duplicates.

- [ ] **Step 4: Run and pass** — the two cargo commands and `pnpm vitest run --project unit packages/contracts`.

- [ ] **Step 5: ARCHITECTURE.md (Asset path: `catalog` from `asset.extras`) and commit**

```bash
git add packages/contracts crates/contracts apps/desktop/src-tauri/src/assets fixtures/protocol/validation-vectors.json ARCHITECTURE.md
git commit -m "Read asset descriptions and tags from glTF extras"
```

### Task 8: MCP thin tools

**Files:**
- Create: `apps/mcp/src/assist-tools.ts`, `apps/mcp/test/assist-tools.integration.test.ts`
- Modify: `apps/mcp/src/server.ts` (call `registerAssistTools(server, api)` after the existing tools), `apps/mcp/package.json` (`@opensekai/assist: workspace:*`), `pnpm-lock.yaml`, `ARCHITECTURE.md` (workspace map rows for `packages/assist` and the `apps/mcp` thin tools)

**Interfaces:**
- Consumes: everything from Tasks 1–6; `invokeTool`, `failure` (`tools.ts`).
- Produces: `registerAssistTools(server: McpServer, api: AppApi): void`; `runIntent(api: AppApi, state: {refs: RefTable}, sceneId: Id, intent: Intent): Promise<Reply<{revision: number; created: Ref[]; notes: Note[]}>>`. Tool names: `scene_summary`, `look_up`, `ask`, `light_setup`, `camera_add`, `camera_move`, `environment_set`, `prop_place`, `haze_set`, `output_camera`, `blueprint_build`. Input schema of an intent tool = `IntentSchemas[tool].omit({tool}).extend({sceneId: IdSchema})`. Descriptions: one sentence each, plus the word lists come from the schema.

- [ ] **Step 1: Write the failing integration test** (real stdio process, `session-fixture.ts`, as `lights.integration.test.ts`)

```ts
it('builds a concert scene with thin tools', async () => {
 // scene_summary → text has '@e' lines; take the avatar ref from it
 // light_setup key/fill/rim with target avatar → ok, created has 3 refs, revision increases
 // haze_set medium → ok
 // camera_add closeUp → created ['@eN']
 // camera_move orbit 90 slow endFraming closeUp on that camera → ok; blueprint_inspect has a graph with an event.manual node
 // output_camera → ok; scene_inspect outputs[0].cameraId is the new camera
 // look_up of the key light → text mentions 'spot'
 // ask {question, choices:['Purple','Blue']} → ok, data echoes the question
 // camera_add with target '@e999' → {ok:false, error:{code:'INVALID_INPUT', ids:['@e999']}}
 // existing tools list still has scene_patch with the same description
}, 20000);
```

- [ ] **Step 2: Run and see it fail** — `pnpm vitest run --project integration apps/mcp/test/assist-tools.integration.test.ts`

- [ ] **Step 3: Implement `assist-tools.ts`**

`runIntent`: `sceneInspect`, `blueprintInspect`, up to 8 `assetList` pages → `assignRefs` → `compileIntents([intent], …)` with `newId` from `crypto.randomUUID()` (Node global; the MCP app may use it) → `toApplyParams` with `clientId: 'opensekai-mcp-assist'` and a new `batchId` → `invokeTool(api, 'proposalApply', …)` → for each `play` entry `invokeTool(api, 'blueprintRun', …)` → store the new table. `scene_summary` returns `{text}`; `look_up` returns `{text}`; `ask` returns the parsed question.

- [ ] **Step 4: Run and pass** — the integration test, then `pnpm vitest run --project integration apps/mcp` (all MCP tests stay green).

- [ ] **Step 5: Commit**

```bash
git add apps/mcp pnpm-lock.yaml ARCHITECTURE.md
git commit -m "Expose the Chat thin tools through MCP"
```

### Task 9: Running app check, evidence, parity

**Files:**
- Create: `docs/evaluation/chat-thin-tools.md`
- Modify: `docs/warudo-parity.md` (a new line under Authoring and extensions: Chat thin tools, partial)

- [ ] **Step 1: Full suite**

Run: `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace`
Expected: all PASS. Record any failure with its output; do not continue past one.

- [ ] **Step 2: Running app**

Check `pgrep -fl opensekai` first (the owner may run a dev app; see memory "Running dev app + HMR"). Start the desktop app from this worktree (`pnpm dev:desktop`), connect the MCP server (`pnpm mcp`), and use the Catboy QA avatar. Build the basic concert scene from the design scenario with the thin tools: three lights, haze, a close-up camera, an orbit with push-in, and the output camera.

- [ ] **Step 3: OBS evidence**

With the local OBS WebSocket (ws://127.0.0.1:4455), add an isolated OpenSekai test Browser Source, record a short local test recording of the Play run, and take a screenshot. Do not stream. Note whether the 15° orbit looks stepped (this is the design's gate for the single orbit node candidate).

- [ ] **Step 4: Evidence file and parity**

`docs/evaluation/chat-thin-tools.md`: commit, backend, quality profile, fixture revision, the tool calls with their replies, revisions, the OBS recording path, and the stepped-or-smooth observation. Parity line: what was verified (thin tools through MCP on macOS, atomic apply, scoped conflict) and what was not (local model, Chat UI, Windows, Linux).

- [ ] **Step 5: Commit**

```bash
git add docs/evaluation/chat-thin-tools.md docs/warudo-parity.md
git commit -m "Record the Chat thin tools evidence"
```
