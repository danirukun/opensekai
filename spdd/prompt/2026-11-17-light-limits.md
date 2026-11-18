# REASONS: Light limits

Date: 2026-11-17. Scope: bundle B34b (#304; ENV-07 #45, ENV-08 #46). Analysis: [light limits](../analysis/2026-11-17-light-limits.md). Depends on: [light entities](2026-10-17-light-entities.md), [stage lights](2026-10-18-stage-lights.md), [stage beams](2026-11-13-stage-beams.md). Changes: light entities R2 and R10; stage lights R2 and R11 (the Add items at 8 lights); stage beams D2, R5, R29, and the 8-mesh beam pool.

The owner made decisions D1 to D7 on 2026-11-16 and 2026-11-17 (#304).

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | At most 32 lights, at most 8 lit lights, at most 2 shadow lights. A lit light has at least one affect flag on. Hidden lights count | One limit of 8 lights |
| D2 | A change that makes a ninth lit light is refused with the budget message. The Affect flag stays off in the Inspector | The light is made unlit without a message |
| D3 | At 8 lit lights, Add makes the light with the three affect flags off. The Add light items are disabled only at 32 lights | Add items disabled at 8 lit lights |
| D4 | No separate haze limit. The cost check measures the haze with unlit scatter lights | A haze limit |
| D5 | The beam mesh pool grows on demand up to 32 meshes and does not shrink | 32 meshes at start |
| D6 | A show with 8 or fewer lights loads without change. No migration, no new field, `schemaVersion` 1 | A show migration |
| D7 | The stage beams fixture show gets its directional and ambient lights back. A second fixture show has 8 lit lights and 24 beam-only lights | One fixture for both jobs |
| D8 | The orchestrator runs LC1 to LC10 on macOS with OBS. GPU time stays unknown until #305 | The implementation run claims them |
| D9 | One pull request. The first commit holds the analysis and this contract | A contract pull request first |

## Limits and messages

This table is the one place for each limit and each message. A requirement refers to a row by its ID.

| ID | Limit | TypeScript | Rust | Message |
| --- | --- | --- | --- | --- |
| M2 | 32 light entities | `LIMITS.lights` | `MAX_LIGHTS` | `Scene has the maximum of 32 lights` |
| M1 | 8 lit lights | `LIMITS.litLights` | `MAX_LIT_LIGHTS` | `Scene has the maximum of 8 lit lights` |
| M3 | 2 lights with `shadow.enabled` | `LIMITS.shadowLights` | `MAX_SHADOW_LIGHTS` | `Scene has the maximum of 2 shadow lights` |

The rows are in check order. When a scene breaks more than one limit, the message is the first row that it breaks.

## R — Requirements

### Schema and validation

R1. A lit light has `affectCharacters`, `affectProps`, or `affectEnvironment` true. Type, visibility, intensity, shadow, beam, and `volumetric` do not change this. TypeScript: `isLitLight(light)`. Rust: `LightSettings::is_lit()`.
R2. `SceneViewSchema` and Rust `SceneView::validate` refuse a scene that breaks a limit of the table. Hidden lights count toward each limit. A haze does not count as a light. An unlit light with a shadow counts toward M3.
R3. A refusal for a light limit has the code `INVALID_INPUT` and exactly the message of the table. TypeScript and Rust use the same texts. Each side keeps the texts in one place (`LIGHT_BUDGET_MESSAGES` in `schema.ts`; constants in `lib.rs`).
R4. Shared vectors in `fixtures/protocol/validation-vectors.json`:
- `light-eight-lit-twenty-four-unlit`: valid. 8 lit and 24 unlit lights, 2 shadow lights (one lit, one unlit), one lit and one unlit light hidden.
- `light-nine-lights` (exists): invalid, message M1.
- `light-thirty-three-lights`: invalid. 8 lit and 25 unlit lights, message M2.
- `light-three-shadows` (exists): invalid, message M3.

Each of these four vectors has a `message` field. Both harnesses check that the message is equal when the field exists.
R5. Each path uses the R2 limits with the R3 message:
- `scenePatch` (the Editor and MCP `scene_patch`) and `proposalApply`, in the session. A refused patch does not change the scene or the revision.
- `sceneReplace`: MCP `validateCall`, the host router (Rust), and the session `replaceScene`.
- Show open and template load (Rust `validate_show`). The Editor status shows the message.
- Assist `light_setup` (R17).
R6. No new patch operation, no new field, and no new show version. `fixtures/shows/stage-lights.osekai`, `fixtures/shows/test-stage.osekai`, and the show templates load without change.

### Editor

R7. The four Add light items (Directional, Point, Spot, Ambient) are disabled when the scene has 32 lights. Below 32 lights they are enabled.
R8. When the scene has 8 lit lights, Add makes each light kind with the three affect flags false. All other values are the Add default of that kind (a Spot Light has no `beam` group and has `volumetric: true`, as in stage beams R22). Below 8 lit lights the Add defaults do not change. An unlit Ambient Light added at 8 lit lights is an ambient entity, so it removes the fixed ambient fill (stage lights R4): the room fill and the environment reflections go to 0; the owner accepted this effect on 2026-11-17.
R9. The Hierarchy Duplicate item is disabled when the copy would break a limit: at 32 lights; for a lit light at 8 lit lights; for a shadow light at 2 shadow lights. Its title does not change.
R10. When the user turns on an affect flag and the session refuses the change with M1, the checkbox shows the scene value again (off) and the Inspector alert shows M1. The checkbox is not disabled in advance. When a light is selected and its Affect section is open, the M1 alert shows directly below the Affect checkboxes, not at the bottom of the Inspector; otherwise it shows in the bottom alert. One M1 alert shows at a time. An alert for another error does not change. (Owner QA, 2026-11-18: the bottom alert was cut off and far from the checkbox.)
R11. The only new visible text is M1 to M3 in the existing alert and status. No new label, helper text, badge, or empty state.

### Renderer

R12. The beam pool starts with no mesh. When a frame has more drawn beams than meshes, the pool adds meshes up to `LIMITS.lights` (32). It removes no mesh before `dispose`. All meshes share one geometry and one material, and each mesh is on `BEAM_LAYER` only, with no shadow flag. A change of the beam count changes the mesh visibility and the per-object values only. It does not compile a material again (stage beams R11).
R13. Each material group (characters, props, environment, haze) keeps its node object while its own light list stays the same: the member IDs in order, the type and shadow switch of each member, and, for the three material groups, the fixed-ambient and built-in-light rule. Thus adding, removing, or changing a light that is in no set (all affect flags off and no haze scatter) gives no lit material and no haze material a new `lightsNode`, and `generation()` does not change. A group whose list changes gets a new node object. A change of `lightSignature` still resets the pass failure state as before (stage beams R15, R15a).
R14. The haze set holds each point or spot light with `volumetric: true`, lit or not (D4). There is no limit apart from R2.
R15. No image readback, no image encode, and no image through Tauri IPC is added to the output path (stage beams R18).

### MCP and chat tools

R16. The MCP `scene_patch` description says that a scene holds at most 32 lights, that at most 8 of them can have an affect flag on, that at most 2 can have a shadow, and that a light with all affect flags off lights nothing but can show a beam and scatter in a haze. No tool is added.
R17. Assist `light_setup` makes a lit light, as before. Without `replace`, it refuses with M2 at 32 lights. It refuses with M1 when the new light, or the light that it replaces, would be the ninth lit light. The replace of a lit light at 8 lit lights is accepted.

### Fixture shows

R18. `fixtures/shows/stage-beams.osekai` gets `light_main` (Directional Light) and `stage_ambient` (Ambient Light) with the values of `fixtures/shows/stage-lights.osekai`. Its four `beam_back_*` spot lights get all three affect flags false. Nothing else changes. Result: 10 lights, 6 lit, 2 shadow lights, 8 beams.
R19. `fixtures/shows/stage-rig.osekai` ("Stage Rig") is valid on both sides. It has the cameras and the environment of Stage Beams; `light_main`, `stage_ambient`, `beam_front_1` to `beam_front_4`, `beam_back_2`, and `beam_back_3` with the Stage Beams values, all lit; and 24 beam-only moving heads in two rows of 12, with the values of the plan. Result: 32 lights, 8 lit, 2 shadow lights, 30 beams, no haze, no character. The −Z axis of each spot light passes within 0.05 m of its aim point.
R20. The Rust show-open test list includes `stage-rig.osekai`.

### Documents and evidence

R21. `ARCHITECTURE.md` (Output path) gives the three limits, the beam pool rule, and the group node rule of R13. `docs/warudo-parity.md` ENV-07 and ENV-08 record only the verified subset.
R22. `docs/evaluation/light-limits.md` records the headless checks with raw counts and one row for each of LC1 to LC10 with "not checked" until the orchestrator fills it. GPU time is unknown, never 0.
R23. The light entities, stage lights, and stage beams contracts get a one-line note "(Changed by light limits Rn.)" at each requirement that this contract changes.
R24. The implementation run claims no macOS, OBS, cost, alpha, or look result.

### Acceptance criteria of #304

| Criterion | Requirements | Checks |
| --- | --- | --- |
| TypeScript and Rust use the same three limits, with shared vectors | R1–R4 | contracts unit tests, `vectors.rs` |
| `scene_patch`, `scene_replace`, show load, assist, and the Editor use the same limits and message | R5, R7–R10, R16, R17 | session, assist, desktop, MCP stdio, and Rust show tests; LC1, LC2 |
| The fixture show gets its directional and ambient lights back | R18 | desktop fixture test, show-open list; LC3 |
| 8 lit and at least 17 beam-only spot lights draw in the preview and OBS with a valid alpha | R12, R19 | stage rig test; LC4, LC5, LC6 |
| Cost at 8 lit and at 32 lights on macOS with OBS at `production_v1` | — | LC7 |
| No Metal shader compile failure after 30 light-set changes | R13, R14 | scene-lights tests; LC8 |
| ENV-07 and ENV-08 record only what was verified | R21, R24 | review |

## E — Entities

- Contracts (TypeScript): `LIMITS.lights` 32, `LIMITS.litLights` 8, `LIMITS.shadowLights` 2; `LIGHT_BUDGET_MESSAGES`; `isLitLight(light)`; `lightBudgetError(entities) → string | null` (R3 order); `lightBudgetIssue(error: ZodError) → string | null` (the budget message among the issues); `isLightBudgetMessage(text)`.
- Contracts (Rust): `MAX_LIGHTS` 32, `MAX_LIT_LIGHTS` 8, `MAX_SHADOW_LIGHTS` 2; the three message constants; `LightSettings::is_lit()`; `light_budget_error(lights) → Option<&'static str>`.
- Editor: `lightLimitReached(entities)` (32), `litLightLimitReached(entities)` (8), `lightCopyLimitReached(entity, entities)`; `EditorView.errorMessage: string | null` (a light budget message only).
- Renderer: `createBeams()` keeps its interface. `SceneLights` keeps its interface; `generation()` increases only when a group node object changes.
- No new `PatchOp`, `PropertyKey`, `AddKind`, entity kind, show field, or MCP tool.

## A — Approach

Contracts first in TypeScript and Rust, with the vectors and their messages. Then the fixture shows, so that the orchestrator can probe early. Then the session and `validateCall`, assist, the renderer (beam pool and group nodes), the Editor, the MCP description, and the documents. The orchestrator runs LC4, LC6, and LC8 as an early probe after the renderer commit, and all checks after the last commit.

## S — Structure

- `packages/contracts/src/schema.ts`, `fixtures/protocol/validation-vectors.json`, `packages/contracts/test/schema.test.ts`, `packages/contracts/test/light-limits.test.ts` (new); `crates/contracts/src/lib.rs`, `crates/contracts/tests/vectors.rs`, `crates/contracts/tests/light_limits.rs` (new).
- `packages/session/src/scene-ops.ts`, `session.ts`; `packages/session/test/light-limits.test.ts` (new).
- `packages/assist/src/compile-scene.ts`, `packages/assist/test/compile-scene.test.ts`.
- `packages/renderer/src/beam.ts`, `scene-lights.ts`; `packages/renderer/test/beam.test.ts`, `scene-lights.test.ts`.
- `apps/desktop/src/editor/lights.ts`, `authoring.ts`, `model.ts`; `components/Hierarchy.svelte`, `Inspector.svelte`; `apps/desktop/test/light-limits.test.ts` (new), `lights.test.ts`, `stage-beams.test.ts`, `stage-rig.test.ts` (new).
- `apps/mcp/src/server.ts`; `apps/mcp/test/light-limits.integration.test.ts` (new).
- `fixtures/shows/stage-beams.osekai`, `fixtures/shows/stage-rig.osekai` (new); `apps/desktop/src-tauri/src/show.rs`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/light-limits.md` (new); the notes of R23 in three contracts.

## O — Operations

1. Contracts, messages, and vectors (R1–R4, R6).
2. Fixture shows and their tests (R18–R20).
3. Session and `validateCall` (R5).
4. Assist (R17).
5. Renderer: the beam pool and the group nodes (R12–R15).
6. Editor (R7–R11).
7. MCP description and stdio test (R16, R5).
8. Documents (R21–R24).
9. Local checks by the orchestrator on macOS (debug build, WebGPU, OBS Browser Source at `production_v1`, 1920 × 1080, 60 FPS, Catboy character):
   - LC1: the limits and the messages through MCP and File › Open in the running app (R2, R3, R5).
   - LC2: the Editor with real input: Add at 8 lit lights, an Affect flag on at 8 lit lights, the Add items at 32 lights, Duplicate (R7–R10).
   - LC3: Stage Beams: the directional and ambient lights are back, and 8 beams show from the Wide, Stage, and Close cameras (R18).
   - LC4: Stage Rig: 30 beams in the preview and in OBS, and no pipeline warning (R12, R19).
   - LC5: OBS alpha of Stage Rig over dark, light, and checker backgrounds (R15).
   - LC6: the beam pool grows from 8 to 30 beams and goes down to 7 with no warning (R12).
   - LC7: cost in four cases (8 lit lights only; the rig; the rig with the 24 head beams off; the rig with a haze and all 32 lights scattering): OBS skipped frames, sampled CPU times, frame rate. GPU time: unknown.
   - LC8: 30 light-set changes, 15 without and 15 with a haze, with `app_status` read after each change: no `Pipeline compile failed` (R13, R14).
   - LC9: the output continues with the Editor minimized, with Stage Rig.
   - LC10: older shows and the template open without change (R6).

## N — Norms

- Unit tests for the schema rule and the messages, the Rust mirror, the session refusals, assist, the beam pool, the group nodes, the Editor model functions, and the fixture shows. One integration test file at the MCP stdio boundary. No test of static copy.
- The look, the cost, WebKit, Metal, and OBS are checked in the running build on macOS by the orchestrator, not in a scratch harness page.
- Functional TypeScript and plain data. Controls come from `@oshi-connect/ui`.
- Long prose is in Simplified Technical English. UI copy is the message only.

## S — Safeguards

- Do not change the show file version, add a field, or add a migration.
- Do not change the quality profiles, the haze constants, the beam constants, or `gpuMs`.
- Do not change how a scene with 8 or fewer lights draws. `lightSignature` keeps its values.
- Do not put the beam in a light node set or in `lightSignature`.
- Do not read images back in the output path.
- Do not add a property registry key or a Blueprint node.
- Do not write a GPU time, a frame time, an OBS result, or a look result that was not measured.
- Keep each message and each limit in one place on each side.
