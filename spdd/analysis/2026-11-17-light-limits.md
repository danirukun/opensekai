# Light limits analysis

Date: 2026-11-17. Scope: bundle B34b (#304; ENV-07 #45, ENV-08 #46). Contract: [light limits](../prompt/2026-11-17-light-limits.md). Depends on: [light entities](../prompt/2026-10-17-light-entities.md), [stage lights](../prompt/2026-10-18-stage-lights.md), [stage beams](../prompt/2026-11-13-stage-beams.md) (PR #303, merge `343923f`).

## Sources

- Issue #304. Owner decision of 2026-11-16: split the light limit into at most 8 lit lights and at most 32 lights in total, with at most 2 shadow lights. A lit light has at least one of Affect Characters, Affect Props, or Affect Environment on. Hidden lights count toward each limit.
- Owner answers on #304, 2026-11-17: Q1 default, Q2 (a), Q3 default, Q4 (b), Q5 default. The section "Decisions" gives the text.
- [Bonnie scene spike](../../docs/superpowers/specs/2026-10-28-bonnie-scene-spike.md). The reference concert scene has DMX fixture groups of 5 moving heads, a grid of 12, and 28 LED pars. Its moving heads give the target of at least 17 beams.
- [Benchmark contract](../../docs/evaluation/benchmark-contract.md). The hall fixture needs beam effects. The proposed gates: a p95 GPU time below 16.67 ms when available, a p95 CPU work below 12 ms, and fewer than 0.1 % OBS render-skipped frames, at 1920 × 1080 and 60 FPS, after a 30 s warm-up, for 120 s.
- [Light entities check](../../docs/evaluation/light-entities.md). The owner saw `bracket nesting level exceeded maximum of 256` from the Metal translation on macOS after many light-set rebuilds. The cloud did not reproduce it with up to 8 lights: the WGSL nesting depth stayed at most 19, and the shader size (at most 48 KB) depended only on the light set. Nobody measured the cost of 8 lights on macOS.
- [Stage beams check](../../docs/evaluation/stage-beams.md). On macOS with OBS, 8 beams add about 0.2 to 0.4 ms of output CPU time (median). GPU time is unknown.
- three.js r187 source. `MeshBasicNodeMaterial` sets `lights = true`. `NodeMaterial.setupLights` uses `material.lightsNode` when it is set, else the light list of the scene. `LightsNode.customCacheKey` includes each light. Thus a basic material without a `lightsNode` (an image, video, or web screen, a light helper, the diagnostic marker) takes every three.js light of the scene, and its program changes when the scene light list changes.

## Current state

### Limits and messages

- `LIMITS.lights` is 8 and `LIMITS.shadowLights` is 2 (`packages/contracts/src/schema.ts` lines 33–34). The `SceneViewSchema` refine checks them at line 274. Its one message for each failure is `Duplicate ID, budget or invalid reference`.
- Rust has `MAX_LIGHTS` 8 and `MAX_SHADOW_LIGHTS` 2 (`crates/contracts/src/lib.rs` lines 18–19). `SceneView::validate` checks them at lines 2502–2513 with the message `too many lights`.
- The session refuses a patch with `Invalid scene references or budget` (`packages/session/src/scene-ops.ts` line 111) and a replace with `Invalid show scene` (`packages/session/src/session.ts` lines 309–310).
- `validateCall` (`schema.ts` lines 721–741) returns `Invalid method or parameters` for each failure. The MCP server calls it before the application (`apps/mcp/src/tools.ts`, `invokeTool`). Thus an MCP `scene_replace` with too many lights never reaches the host, and its reply does not name the limit.
- A show file goes through Rust `validate_show` (`apps/desktop/src-tauri/src/show.rs` lines 91–111). The Editor status shows the Rust message `too many lights`.
- Assist refuses a ninth light with `Scene has the maximum of 8 lights` (`packages/assist/src/compile-scene.ts` line 41). It skips the shadow at 2 shadow lights (line 45).
- Thus five texts exist for the same limit. #304 asks for one message on each path.
- Shared vectors: `light-eight-lights` (valid), `light-nine-lights` (invalid, 9 lit lights), `light-three-shadows` (invalid). No vector has a message. The TypeScript harness (`packages/contracts/test/schema.test.ts`) checks the result. The Rust harness (`crates/contracts/tests/vectors.rs`) checks the result and the error code.

### Editor

- `lightLimitReached` (`apps/desktop/src/editor/lights.ts` line 31) counts all lights against `LIMITS.lights`. `addLimitReached` (`editor/authoring.ts` line 44) uses it for the four Add light items.
- `makeAuthoringEntity` (`editor/authoring.ts`) makes each light from its Add default, with the three affect flags on.
- The Hierarchy Duplicate item (`components/Hierarchy.svelte` line 89) is disabled when the copy breaks a limit: the light count, or a third shadow. The screens use the same rule (`editor/screen.ts` lines 40–41).
- The editor model keeps the error code only (`editor/model.ts` line 8 `error: ErrorCode | null`, line 42). The Inspector alert shows the code (`components/Inspector.svelte` line 154). A rejected light change shows the scene value again (stage beams R25).

### Renderer

- `lightGroups` (`packages/renderer/src/scene-lights.ts` lines 19–27) puts a light in the characters, props, or environment set only when its affect flag is on. A light with all three flags off is in no material set. The `haze` set holds each point or spot light with `volumetric`, lit or not.
- `lightSignature` (lines 48–52) holds the ID, the type, the three flags, the shadow switch, and the haze scatter of every light. When it changes, `apply` (lines 181–201) makes new node objects for all four sets. `assign` then gives each lit material a new `lightsNode` and disposes it, so it compiles again. `renderer.ts` lines 241–242 reset the pass failure state, and line 440 runs `compileAsync` when a shadow exists. Thus today an added or removed unlit light recompiles each lit material, although no set changes.
- Each light entity is a three.js light in the scene graph. A basic material without `lightsNode` takes all of them (see Sources).
- `beam.ts` line 63 makes `LIMITS.lights` (8) cone meshes at start. They share one geometry and one material, with per-object values. `update` draws the first 8 beams.
- `beamDraws` does not read the affect flags. An unlit spot light with the beam on draws its beam, with the gain from its Intensity.

### MCP, fixtures, and documents

- The `scene_patch` description (`apps/mcp/src/server.ts` line 7) says "a scene holds at most 8 lights and 2 shadow lights".
- `fixtures/shows/stage-beams.osekai` has 8 lit spot lights with beams (2 with a shadow) and no directional or ambient light (stage beams R29). `fixtures/shows/stage-lights.osekai` and the Stage Lights template have 4 lit lights.
- `ARCHITECTURE.md`, Output path, says "at most 8, at most 2 with a shadow", "at most 8" beam meshes, and "a change of type, affect flag, shadow switch, or light count rebuilds the groups".
- `docs/warudo-parity.md`: ENV-07 says "at most 8 directional or point light entities"; ENV-08 says "at most 8 beams".
- These contracts state the 8-light limit: light entities R2 and R10, stage lights R2 and R11, stage beams D2, R5, and R29.

## Decisions

Decisions 1 to 7 are owner decisions. Decisions 8 and 9 are integrator decisions.

1. **Split** (2026-11-16). At most 32 lights, at most 8 lit lights, at most 2 shadow lights. Hidden lights count toward each limit. A haze does not count.
2. **A ninth lit light** (Q1, default). A patch that makes a ninth lit light is refused with the budget message. In the Inspector the Affect flag stays off.
3. **Add items** (Q2 (a)). At 8 lit lights, Add makes the new light with all three Affect flags off, so it can be a beam-only light. The Add light items are disabled only at 32 lights.
4. **Haze** (Q3, default). An unlit light with Scatter In Haze gets no separate limit. The cost check measures the haze with such lights.
5. **Beam pool** (Q4 (b)). The pool grows on demand up to 32 meshes and does not shrink.
6. **Old shows** (Q5, default). A show with 8 or fewer lights loads without change. No migration.
7. **Fixture** (issue acceptance criteria). The stage beams fixture show gets its directional light and its ambient light back. Stage beams R29 changes back.
8. **One pull request.** The first commit holds this analysis and the contract. Branch `claude/b34b-light-limits`. Alternative: a contract pull request first.
9. **Evidence owners.** The orchestrator runs the macOS and OBS checks. GPU time stays unknown until #305. The implementation run claims no macOS, OBS, cost, or look result.

## Technical choices

Each choice is reversible. The recommendation is in bold.

- **T1. Names.** (a) **Keep `LIMITS.lights` and `MAX_LIGHTS` as the total and set them to 32; add `LIMITS.litLights` and `MAX_LIT_LIGHTS` (8).** (b) Rename to `totalLights`. Reason: each current caller outside validation (the Add items, the beam pool, the assist count) means "all lights" after the split, so it stays correct when only the value changes. There are also fewer edits in shared files.
- **T2. One message.** (a) **One pure function on each side (`lightBudgetError`, `light_budget_error`) gives one of three messages in a fixed order. The zod schema reports it as its issue message. The session, `validateCall`, Rust validation, and assist use it. The shared vectors carry the message, so a test pins both sides.** (b) Keep a message for each path. (b) does not meet the acceptance criterion "the same message".
- **T3. Node sets and unlit lights.** (a) **Each material group keeps its node object while its own light list stays the same: the members, their type and shadow switch, and the fixed-ambient or built-in rule. Adding, removing, or changing a light that is in no set does not replace a node, so no lit material compiles again. The light signature and the failure reset stay as they are.** (b) No change: each such edit recompiles each lit material. Reason: #304 says that an unlit light "adds no shading cost", but today its add and its remove recompile the whole scene. The Metal failure came after many rebuilds, and a rig edit adds and removes many unlit lights. The change stays in `scene-lights.ts`, because `renderer.ts` already reassigns materials only when `generation()` changes.
- **T4. Basic materials and the scene light list.** (a) **No change. Measure in LC7 and LC8.** (b) Give each basic material an empty `lightsNode`, so it does not take the scene lights. Reason: this is existing three.js behavior at 8 lights, and no failure is known. (b) would change screens, web screens, helpers, and the marker. If LC8 fails or LC7 shows a recompile hitch, (b) is the first fallback, and the orchestrator decides.
- **T5. Message in the Editor.** (a) **The model keeps the reply message only when it is a light budget message, and the Inspector alert shows it. Other alerts do not change.** (b) Show each session message. Reason: owner Q1 needs the budget message. (b) changes every alert, and no issue asks for that.
- **T6. Duplicate.** (a) **The existing rule: Duplicate is disabled when the copy would break a limit (32 lights; a lit light at 8 lit lights; a shadow light at 2 shadow lights).** (b) Make an unlit copy at 8 lit lights, as Add does. Reason: a copy must be equal to its source, and the shadow and screen rules work the same way. The user can Add a beam-only light.
- **T7. Fixtures.** (a) **`stage-beams.osekai` gets the directional and ambient lights back, and its 4 back spot lights become beam-only (10 lights, 6 lit). A new `stage-rig.osekai` has 8 lit lights and 24 beam-only moving heads (32 lights, 30 beams).** (b) One show for both jobs. Reason: Stage Beams stays the look reference of B34 and keeps 2 lit places free for the Editor check of Add at 8 lit lights. Stage Rig gives the 17-beam case and the 32-light cost case.
- **T8. Beam pool at start.** (a) **Empty at start. It grows to the drawn count.** (b) 8 meshes at start, then growth. Reason: the owner chose "on demand". A scene without a beam makes no mesh. A new mesh uses the same material and geometry, so three.js should use the same pipeline again. A GPU has not verified this (LC6).
- **T9. Assist at 8 lit lights.** (a) **`light_setup` refuses with the lit-light message.** (b) It makes an unlit light. Reason: a key, fill, rim, or ambient light must light something.

## Effects

- A scene can hold 32 lights. At most 8 of them light materials. The others can show a beam and can scatter in a haze.
- Each path gives the same message for each light limit.
- The show format and its version do not change. A show with 8 or fewer lights opens as before. A show with 9 to 32 lights does not open in an app build from before this change: Rust refuses it with "too many lights".
- At 8 lit lights, Add makes an unlit light. An unlit Spot Light shows nothing until Beam is on (stage beams D6) or a haze exists. An unlit Ambient Light still replaces the fixed ambient fill (stage lights R4), so the scene can get darker. Issues Q1 and Q2 ask the owner about these two effects.

## Risks

- **Haze.** Up to 32 lights can scatter in one haze. The ray-march cost grows with lights × 12 steps, and the haze shader grows. Metal failed once after many rebuilds at 8 lights. LC7 case D and LC8 measure this. If they fail, the owner decides on a haze limit (this reopens Q3).
- **Basic materials** take the scene light list (T4). Their shader holds the setup of up to 32 lights. They compile again when that list changes.
- **Beam overdraw.** 30 beams at half resolution. The cost is unknown, and GPU time is unknown (#305).
- **A new beam mesh** (T8) makes a new render object in its first frame. A hitch or a warning would show in LC6.
- **T3 changes merged code.** Tests pin the existing generation, failure-reset, and material-refresh behavior.
- **An unlit light with a shadow** counts toward the 2 shadow lights. Whether three.js renders its shadow map when the light is in no material set has not been checked. A haze set that holds it renders the map.
- **The 30-change check.** The `Pipeline compile failed` warning clears at the next light-set rebuild, so LC8 must read `app_status` after each step.
- **Wording.** "lit lights" is a new term in the messages (issues Q3).
- **Rebase.** `schema.ts`, `server.ts` line 7 (one long line), `ARCHITECTURE.md`, and `docs/warudo-parity.md` are shared files.
- **Editor viewport.** 32 light helpers can overlap and make picking hard. No requirement changes this.

## Out of scope

DMX input (EXT-12, #105), fixture group entities, instanced beam draws, moving-head motion presets, spot cookies (gobos), Windows, GPU time (#305), a haze limit, quality profile changes, a Blueprint target for the affect flags, the WebGL 2 avatar defect, and the missing reset marks of the stage beams check (LC5).
