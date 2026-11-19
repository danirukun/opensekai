# Character Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MToon avatars get shadows that go to the shade color, a rim from each back light, a flattened environment fill, per-character Lighting controls, a better default light rig, and a Lighting Demo show.

**Architecture:** A `CharacterMToonMaterial` subclass of three-vrm `MToonNodeMaterial` with a `CharacterLightingModel`. Per-character values are material properties read through `materialReference` (uniform writes, no recompile). The scene-wide fill color is one shared uniform. Data flows as for camera grading: an optional entity group, one patch operation, TS and Rust schemas, shared validation vectors.

**Tech Stack:** three 0.187.0 (WebGPU, TSL), @pixiv/three-vrm 3.5.5, Zod, Rust `opensekai-contracts`, Svelte 5, Vitest, Blender 5.2 (headless).

**Spec:** `docs/superpowers/specs/2026-11-19-character-lighting-design.md`. Template change: camera grading, commit `af0af92` (`git show --stat af0af92` lists each place an entity group must reach).

## Global Constraints

- Work in this worktree. Verify `pwd` before Git. No `git -C`, no compound `cd`.
- Run each cargo, pnpm, or Tauri command that compiles Rust through `direnv exec . <command>`. Shared target `$HOME/.cache/opensekai/target`.
- Do not change three or three-vrm versions. No new package patch. Keep `patches/@pixiv__three-vrm@3.5.5.patch`; the overridden `direct()` uses `normalView`, not `transformedNormalView`.
- `isMToonNodeMaterial` stays true on the subclass. Its `type` is `'CharacterMToonMaterial'`.
- `lighting` is optional on the avatar entity; a missing group means `DEFAULT_AVATAR_LIGHTING` (owner decision: existing shows get the new look).
- Ranges: `rimStrength` 0–2, `rimWidth` 0–1, `rimTint` `#rrggbb` (`LightColorSchema`), `shadowStrength` 0–1, `environmentFill` 0–2.
- Initial defaults (Task 8 tunes them): `rimStrength 1`, `rimWidth 0.5`, `rimTint '#ffffff'`, `shadowStrength 0.6`, `environmentFill 1`.
- A value change is a uniform write. A light-set change is the only recompile trigger, as today.
- No specular reflection of the room map on avatars. Props and environments keep `RoomStandardMaterial`.
- Fill color: white when `usesFixedAmbient(entities)`; else the sum of color × intensity of visible ambient light entities with `affectCharacters` on.
- No image readback or image stream through Tauri IPC. No commit attribution to an agent.
- Commit messages: short, imperative, full sentence, like `git log`.
- Long prose (spdd, evaluation, parity) in ASD-STE100. UI copy is the labels only: Lighting, Rim Strength, Rim Width, Rim Tint, Shadow Strength, Environment Fill.
- All slices stay on this branch; one PR after the owner's look check.

## Review Focus

1. **MToon outline materials** (`isOutline`): the outline must not get the added rim or the environment fill; a bright outline ring is a clear regression. Test in Task 3.
2. **Hidden lights:** a hidden light (intensity 0) adds no rim; a hidden ambient light removes its share of the fill. Test in Task 2 (`characterFill`) and Task 3 (rim scales with light color).
3. **Scene with no light entity** (built-in light): the avatar has white fill and the shadow fix; no `Pipeline compile failed`. Test in Task 4.
4. **Two avatars of the same model with different Lighting values** stay independent. Test in Task 4.
5. **Transparent and cutout MToon materials** (hair cards) on the OBS output: no bright halo and background alpha 0 at the rim. Check in Task 8 over dark, light, and checker backgrounds.

---

### Task 0: Setup and slice contract

**Files:**
- Create: `spdd/analysis/2026-11-19-character-lighting.md`, `spdd/prompt/2026-11-19-character-lighting.md`

- [ ] **Step 1:** `pwd` (expect the worktree), `direnv allow`, `pnpm i`.
- [ ] **Step 2:** Write the analysis (problem, current state, decisions) from the design, in the format of `spdd/analysis/2026-11-10-camera-grading.md`.
- [ ] **Step 3:** Write the REASONS contract in the format of `spdd/prompt/2026-11-03-material-profiles.md`. Requirements R1–R9 map to Tasks 1–8 of this plan; Safeguards copy the design anti-goals. Issue refs: #73, #45.
- [ ] **Step 4:** Commit: `Add the character lighting slice contract.`

### Task 1: Avatar lighting group in the contracts and the session

**Files:**
- Create: `packages/contracts/src/avatar-lighting.ts`, `packages/contracts/test/avatar-lighting.test.ts`, `packages/session/test/avatar-lighting-patch.test.ts`, `crates/contracts/tests/avatar_lighting.rs`
- Modify: `packages/contracts/src/index.ts`, `schema.ts` (avatar entity, `PatchOpSchema`), `types.ts` (entity type, `LivePatchOp`); `packages/session/src/scene-ops.ts`; `crates/contracts/src/lib.rs` (`object!(AvatarLighting …)`, `impl Validate`, avatar field, patch op); `fixtures/protocol/validation-vectors.json`

**Interfaces:**
- Produces: `AvatarLightingSchema`, `type AvatarLighting = {rimStrength:number; rimWidth:number; rimTint:string; shadowStrength:number; environmentFill:number}`, `DEFAULT_AVATAR_LIGHTING: AvatarLighting` (frozen), `avatarLighting(entity): AvatarLighting` (the group or the default). Patch op `{kind:'setAvatarLighting'; entityId:Id; lighting:AvatarLighting|null}` (`null` removes the group).

- [ ] **Step 1: Failing tests** (`avatar-lighting.test.ts`): an avatar with and without `lighting` parses; each field at min and max parses; `rimStrength 2.01`, `rimWidth -0.01`, `shadowStrength 1.01`, `environmentFill 2.01`, `rimTint 'red'`, and an extra key fail; `setAvatarLighting` with a group and with `null` parses; `avatarLighting` of an avatar without a group equals `DEFAULT_AVATAR_LIGHTING`.
- [ ] **Step 2:** `pnpm vitest run packages/contracts/test/avatar-lighting.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the schema, the default, the helper, and the entity field and patch op, as `grading.ts` does.
- [ ] **Step 4: Session test** (`avatar-lighting-patch.test.ts`, like `grading-patch.test.ts`): the op sets the group; `null` deletes it; the op on a camera fails with `INVALID_INPUT` `'Entity is not an avatar'`. Add the `scene-ops.ts` case. Run → PASS.
- [ ] **Step 5: Rust:** mirror the struct, ranges (`within`, `light_color_ok`), field, and op. `avatar_lighting.rs` tests the same valid and invalid cases. Add vectors `set-avatar-lighting-ok`, `set-avatar-lighting-null`, `set-avatar-lighting-rim-over` (`rimStrength 2.01`, `INVALID_INPUT`), `avatar-lighting-extra-key`.
- [ ] **Step 6:** `pnpm vitest run packages/contracts packages/session` and `direnv exec . cargo test -p opensekai-contracts` → PASS.
- [ ] **Step 7:** Commit: `Add the avatar lighting group and its patch operation.`

### Task 2: Pure lighting math

**Files:**
- Create: `packages/renderer/src/character-lighting-math.ts`, `packages/renderer/test/character-lighting-math.test.ts`

**Interfaces:**
- Produces (pure, plain numbers; the shader in Task 3 uses the same constants, exported as `RIM` and `EXPONENT`):
  - `toonShading(dotNL, shift, toony, shadow, shadowStrength): number` = `linearstep(−f, f, dotNL + shift) × mix(1, shadow, shadowStrength)`, `f = 1 − toony`.
  - `rimExponent(width): number` = `mix(EXPONENT.narrow, EXPONENT.wide, width)`; start with `narrow 8`, `wide 1.5`.
  - `rimFactor(nDotV, lDotV, width): number` = `pow(clamp(1 − nDotV), rimExponent(width)) × smoothstep(RIM.backStart, RIM.backEnd, −lDotV)`; start with `backStart −0.1`, `backEnd 0.6`.
  - `equalize(sample: Vec3, average: Vec3, factor): Vec3` = `mix(sample, average, factor)`.
  - `characterFill(entities: readonly SceneEntity[]): Vec3` (rule in Global Constraints).

- [ ] **Step 1: Failing tests:**
  - `toonShading(0.5, 0, 0.9, 0, 1) === 0` (full shadow, full strength → shade); `toonShading(0.5, 0, 0.9, 0, 0) === 1`; `toonShading(0.5, 0, 0.9, 0, 0.6) ≈ 0.4`; `toonShading(-0.5, 0, 0.9, 1, 1) === 0`.
  - `rimFactor(0.05, -1, 0.5) > 0.5`; `rimFactor(0.05, 1, 0.5) === 0` (light in front); `rimFactor(1, -1, 0.5) === 0` (face center); `rimFactor(0.5, -1, 1) > rimFactor(0.5, -1, 0)`.
  - `equalize([1,0,0],[0,0,1],1)` equals `[0,0,1]`; factor 0 returns the sample.
  - `characterFill`: no light entity → `[1,1,1]`; one ambient `#ff0000` intensity 0.5 → `[0.5,0,0]`; the same ambient hidden → `[0,0,0]`; with `affectCharacters false` → `[0,0,0]`; two ambients add.
- [ ] **Step 2:** `pnpm vitest run packages/renderer/test/character-lighting-math.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `characterFill` reuses `usesFixedAmbient` and `isLight` from `scene-lights.ts`.
- [ ] **Step 4:** Run → PASS. Commit: `Add the character lighting math.`

### Task 3: CharacterMToonMaterial and its lighting model

**Files:**
- Create: `packages/renderer/src/character-mtoon.ts`, `packages/renderer/test/character-mtoon.test.ts`
- Modify: `packages/renderer/src/assets.ts:135` (`materialType: CharacterMToonMaterial`)

**Interfaces:**
- Consumes: Task 2 constants and formulas.
- Produces: `class CharacterMToonMaterial extends MToonNodeMaterial` with numeric properties `rimStrength`, `rimWidth`, `shadowStrength`, `environmentFill`, `giEqualizationFactor`, and `rimTint: Color`; `isCharacterMToonMaterial === true`; `type === 'CharacterMToonMaterial'`. `characterFillUniform: UniformNode<'color'>` (module-level, shared). `setRoomMap(texture: Texture | null)` (module-level; the env node of all character materials).

- [ ] **Step 1: Failing tests** (no GPU draw, like the MAT-01 renderer tests):
  - Loading a small VRM 0.x MToon GLB built in the test through `createAssetLoader` gives `CharacterMToonMaterial` for the surface and its outline clone; `isMToonNodeMaterial` is true; `isLitMaterial` is true.
  - A VRM 0.x material with `_IndirectLightIntensity` 0.3 gives `giEqualizationFactor 0.7` (v0compat writes `1 − _IndirectLightIntensity`, default intensity 0.1, and leaves it undefined for 0); a missing property gives `0.9`.
  - `clone()` keeps the five values and `rimTint`.
  - The existing `mtoon-uv` per-frame test still passes with the new class.
- [ ] **Step 2:** `pnpm vitest run packages/renderer/test/character-mtoon.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
  - Constructor reads `parameters.giEqualizationFactor` before `super()` deletes it; `copy()` copies the new fields.
  - `setupLighting(builder)`: set `builder.context.getShadow = lightNode => lightNode.baseColorNode`, call super, restore the previous value. This keeps the shadow out of the light color.
  - `CharacterLightingModel.direct({lightDirection, lightColor, lightNode, reflectedLight})`: `shadow = lightNode.shadowNode ?? float(1)`; shading per `toonShading`; diffuse as the parent (`mix(shadeColor, diffuseColor, shading)`); authored rim as the parent; then, when not `isOutline`, add `rimFactor(N·V, L·V, rimWidth) × rimStrength × rimTint × lightColor` to `directSpecular`. Use `normalView`. Read the five values through `materialReference`.
  - `indirectDiffuse`: parent term, plus (not for outlines) `equalize(iblIrradiance, average, giEqualizationFactor) × characterFillUniform × environmentFill × BRDF_Lambert(diffuseColor)`. `average` = mean of the room irradiance at world up and world down (two samples).
  - `setupEnvironment` returns the room map env node from `setRoomMap`, with the specular part dropped (the `RoomEnvironmentNode` pattern in `environment-light.ts`).
- [ ] **Step 4:** Run the new test and `pnpm vitest run packages/renderer` → PASS.
- [ ] **Step 5:** Run the MAT-01 headless check `docs/evaluation/material-profiles/headless-check.mjs` (WebGPU and WebGL 2) → each fixture loads, no pipeline compile failure.
- [ ] **Step 6:** Commit: `Light MToon avatars with shadows to the shade color, a back-light rim, and an environment fill.`

### Task 4: Renderer wiring

**Files:**
- Modify: `packages/renderer/src/avatar-pose.ts` (binding gets `lighting(values: AvatarLighting): void`), `renderer.ts` (call it near `value.avatar?.uv(...)` at :387 and :407; set `characterFillUniform` from `characterFill(entities)` where `sceneLights.apply` runs; call `setRoomMap` with the room map that `createEnvironmentLight` makes), `environment-light.ts` (expose the map texture without changing prop behavior)
- Test: `packages/renderer/test/character-lighting-frame.test.ts`

- [ ] **Step 1: Failing tests** through the renderer frame path, as the MAT-01 UV test does:
  - an avatar without `lighting` gets the default values on each `CharacterMToonMaterial`;
  - `setAvatarLighting` with `rimStrength 2` changes the property and the material `version` does not change (no recompile);
  - two avatar entities of the same asset with different values keep their own values;
  - a scene with no light entity: fill uniform `[1,1,1]`; an ambient `#336699` intensity 1: fill uniform equals that color in linear values.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `pnpm vitest run packages/renderer` → PASS.
- [ ] **Step 5:** Commit: `Apply each character's lighting values and the scene fill on each frame.`

### Task 5: Editor, MCP, and Blueprint

**Files:**
- Create: `apps/desktop/src/components/AvatarLightingFields.svelte`, `apps/desktop/src/editor/avatar-lighting.ts`
- Modify: `apps/desktop/src/editor/model.ts` (`setAvatarLighting(entityId, lighting|null, expectedRevision?, live=false)`), `Inspector.svelte`, `inspector-sections.ts` (a `lighting` section on avatars), `property-defaults.ts`, `live-fields.ts`, `slider.ts`; `apps/mcp/src/server.ts` (add `setAvatarLighting` to the `scene_patch` description); `packages/contracts/src/property-registry.ts` (`rimStrength`, kinds `['avatar']`, range 0–2) and `packages/session/src/overrides.ts`
- Test: `apps/desktop/test/editor-model.test.ts`, `inspector-sections.test.ts`, `property-defaults.test.ts`, `apps/mcp/test/avatar-lighting.integration.test.ts`, `packages/contracts/test/` property-registry test

- [ ] **Step 1: Failing tests:** `model.setAvatarLighting` sends one `setAvatarLighting` op and refuses a non-avatar; an avatar has a `lighting` Inspector section; reset marks show for a value that differs from `DEFAULT_AVATAR_LIGHTING`; MCP stdio `scene_patch` with `setAvatarLighting` changes the revision and an out-of-range value fails with `INVALID_INPUT`; Blueprint `rimStrength` reads the default and writes through `setAvatarLighting`.
- [ ] **Step 2:** Run each test → FAIL. **Step 3:** Implement, following `CameraGradingFields.svelte` (sliders with number fields, the native color swatch for Rim Tint, live sliders). **Step 4:** Run `pnpm vitest run apps/desktop apps/mcp packages/contracts packages/session` → PASS; `pnpm check` → no errors.
- [ ] **Step 5:** Commit: `Add character lighting controls to the Inspector, MCP, and Blueprints.`

### Task 6: Default light rig for a new scene

**Files:**
- Modify: `apps/desktop/src/editor/lights.ts`, `authoring.ts:63`
- Test: `apps/desktop/test/authoring.test.ts`

**Interfaces:**
- Produces: `KEY_LIGHT` (directional, `#fff1e0`, intensity 3, shadow on, soft), `BACK_LIGHT` (directional, `#cfe0ff`, intensity 2, no shadow), `FILL_LIGHT` (ambient, `#ffffff`, intensity 0.4); `BACK_LIGHT_ROTATION: Quat` (−Z from `[-1.5, 3, -3]` toward `[0, 1.2, 0]`).

- [ ] **Step 1: Failing test:** a new scene has `camera_main`, `light_key`, `light_back`, `light_fill`; 3 lit lights and 1 shadow light; the −Z axis of `BACK_LIGHT_ROTATION` equals the normalized `[1.5, -1.8, 3]` within 1e-5; the scene passes `ShowSceneSchema`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; the key light keeps `lightTransform('directional')`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `Start a new scene with a key, back, and fill light.`

### Task 7: Lighting demo stage and show

**Files:**
- Create: `scripts/lighting-stage/build_lighting_stage.py`, `fixtures/shows/lighting-demo.osekai`
- Modify: `fixtures/cloud/manifest.json` (`fixture_lighting_stage`), `docs/testing.md` (Fixtures table), `package.json` (`build:lighting-stage`)

- [ ] **Step 1:** Write the script in the pattern of `scripts/test-stage/build_test_stage.py` (headless, CC0 credits, glTF coordinates, no downloads): a 12 × 12 m dark floor (roughness 0.35), a back wall with 5 vertical emissive strips (2 cool, 2 warm, 1 magenta), a 0.2 m round platform of radius 1.5 m at the origin, two shadow-catching boxes at ±2.5 m.
- [ ] **Step 2:** Run `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/lighting-stage/build_lighting_stage.py -- --out <scratchpad>/lighting-stage.glb`. Expect one GLB; `pnpm exec tsx scripts/gltf-validate.ts <file>` → no errors. Do not use the open Blender session.
- [ ] **Step 3:** Upload to `opensekai-fixtures` under `sha256/<hash>.glb` (`pnpm dlx wrangler@4 r2 object put … --remote`, `CLOUDFLARE_ACCOUNT_ID` set; ask the owner before the upload). Add the manifest entry; `pnpm exec tsx scripts/prepare-fixtures.ts` downloads and verifies it.
- [ ] **Step 4:** Write `lighting-demo.osekai` (copy the structure of `stage-beams.osekai`): the stage, Catboy (`fixture_vrm0_arkit`) on the platform, a warm key directional light with soft shadow, two point back lights (`#5ab4ff` left, `#ff5ad2` right) behind the avatar, an ambient light `#1a2240` intensity 0.6, a haze with 2 beam spot lights, camera `Wide` with ACES grading and bloom intensity 0.4, threshold 1.0, and camera `Face` (close-up). Total lit lights ≤ 6, shadow lights 1. The show passes `ShowSchema` (add it to the fixture show parse test if one exists).
- [ ] **Step 5:** Commit: `Add the lighting demo stage and show.`

### Task 8: Tuning and macOS evidence

**Files:**
- Create: `docs/evaluation/character-lighting.md` and its images
- Modify: `packages/contracts/src/avatar-lighting.ts` (tuned defaults), vectors if defaults change, `docs/warudo-parity.md` (MAT-01, ENV-07), `ARCHITECTURE.md` (character lighting on the output path), the spdd contract (status)

- [ ] **Step 1:** Build from this worktree; launch the dev app (check `pgrep` first; see the running-dev-app memory). Load each of the 8 VRMs in iCloud Drive › VTuber Avatars under the default rig; capture before (main) and after. Tune the defaults and `RIM`/`EXPONENT`; the face under the built-in light must not get darker than before by more than about 10 % in mean luminance of a face patch.
- [ ] **Step 2:** Open `lighting-demo.osekai`; check in the preview and OBS (local WebSocket, isolated test source): rim from each back light; on the `Face` camera the key shadow goes to the shade color; OBS over dark, light, and checker: no halo at hair edges, background alpha 0; editor minimized, output continues.
- [ ] **Step 3: Cost:** time the Editor stall for Add of a lit light at 1, 3, and 8 lit lights, on main and on this branch; fail if 8 lights is more than 20 % longer. 30 light-set changes at 8 lit lights: no `Pipeline compile failed`. Record output CPU frame time; GPU time is unknown (#305).
- [ ] **Step 4:** Write the evaluation (backend, quality profile, fixture revision, commit, results, unknowns). Update parity rows for only what was verified. Update `ARCHITECTURE.md`.
- [ ] **Step 5:** `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `direnv exec . cargo fmt --check`, `direnv exec . cargo clippy`, `direnv exec . cargo test --workspace` → pass. `direnv exec . cargo sweep --time 7`.
- [ ] **Step 6:** Commit: `Record the character lighting evidence.` Then the owner's look check, then push and open the PR.
