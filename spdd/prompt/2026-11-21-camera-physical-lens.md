# REASONS: Physical camera lens, presets, and TSL look stack

Date: 2026-11-21. Scope: issue [#343](https://github.com/danirukun/opensekai/issues/343). Analysis: [physical camera lens](../analysis/2026-11-21-camera-physical-lens.md). Design: [camera physical lens design](../../docs/superpowers/specs/2026-11-21-camera-physical-lens-design.md). Plan: [camera physical lens plan](../../docs/superpowers/plans/2026-11-21-camera-physical-lens.md). Depends on: B37 / #172 (`CameraEffectsSchema` shape this work extends). Changes: `LensSchema` / Rust `Lens` (new required physical fields with migrate-on-parse); `CameraEffectsSchema` (four new optional groups); `post-chain.ts` (one new stage before bloom, two after); `property-registry.ts` (five new keys).

The owner approved D1 to D8 on 2026-11-21 (also recorded in the design doc). The integrator sets D9 to D12 in this contract. V1 to V5 are reversible starting values; the owner can change each one in review without reopening the contract.

## Decisions

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | Default sensor is Full Frame 36×24 mm for new cameras and for Default. three.js's implicit 35 mm `filmGauge` is never left standing | Keep three.js's default film gauge |
| D2 | Ship the TSL `FilmNode` for film grain in this issue; off by default; mild on Cinematic only | Defer grain to a later issue |
| D3 | Flare is `LensflareNode` on the bloom buffer **and** a separate anamorphic smear; each can turn off on its own | One combined flare toggle |
| D4 | `fovDegrees` stays writable. A write converts through the camera's current sensor into `focalLengthMm`; `fStop` does not change | Make `fovDegrees` read-only once the physical lens ships |
| D5 | Preview quality cheapens DoF, flare, and anamorphic; it never force-disables them | Preview forces the new effects off |
| D6 | The UI keeps a real f-stop. A documented heuristic maps f-stop and focal length onto `DepthOfFieldNode`. No Warudo DoF parity claim before a VM check of Warudo's unitless aperture | Reverse-engineer a bit-exact Warudo match without the VM check |
| D7 | Depth of field stays off on the Default preset and on every new camera (#340) | DoF on by default with a conservative bokeh |
| D8 | One implementation pass, one PR, approach C, on `feat/camera-lens-343`; internal commits follow contract → renderer → UI order | Phase the work into several PRs |
| D9 | `depthOfField`, `lensFlare`, `anamorphicFlare`, `filmGrain` nest inside the existing `CameraEffectsSchema`, sharing one `setCameraEffects` patch and one "Effects" Inspector section | A second schema and a second patch operation |
| D10 | Post-chain order: DoF before bloom; flare and anamorphic smear read the bloom buffer after bloom; film grain after lens dirt / grade, before the existing stylized effects | DoF after bloom; grain before grade |
| D11 | Pure lens and DoF-heuristic math lives in one new contracts module, `lens-math.ts`, with no three.js import, mirroring the B37 `camera-effects-math.ts` pattern | Inline the formulas in the renderer module only |
| D12 | Unlike the B37 effect groups (optional, omitted-when-absent), the Lens physical fields are required once present. A document with only the legacy `{fovDegrees, near, far}` shape normalizes to the full physical shape **on parse**, through Full Frame convert, and is not required to keep its exact old bytes on the next save | Make the new physical fields optional, mirroring the effects-group omission pattern |

### Interpretations (reversible)

| # | Chosen | Alternative |
| --- | --- | --- |
| V1 | Concert preset uses 85 mm on Full Frame (about 16° vertical FOV, under the 35° ceiling) | A longer focal length with a narrower FOV margin |
| V2 | `bokehScale(focalLengthMm, fStop, quality)` = `clamp((focalLengthMm / fStop) * K, 0, MAX)`, `K_full = 0.02`, `K_cheap = 0.008`, `MAX_full = 8`, `MAX_cheap = 3` | A lookup table keyed on named f-stops |
| V3 | `dofFocalRangeWorld(focusDistance, fStop, quality)` = `max(0.05, focusDistance * (fStop / 32) * (cheap ? 1.5 : 1))` | A fixed range independent of f-stop |
| V4 | `applyPerspectiveLens` sets `filmGauge` and `setFocalLength` (for DoF and sensor consumers), then sets `camera.fov = lens.fovDegrees` directly, so the stored, derived FOV always matches the rendered frame | Let three.js's own FOV-from-focal-length stand, and resync stored `fovDegrees` to it on apply |
| V5 | The anamorphic smear approximates Warudo's ZH smear as far as one small TSL pass allows; it is not bit-identical to the project's removed `AnamorphicNode` | Match Warudo exactly, including the removed node's math |

## Constants

| Name | Value | Use |
| --- | --- | --- |
| `SENSOR_PRESETS.fullFrame` | `{36, 24}` mm | Default sensor (D1); `filmGauge` width |
| `SENSOR_PRESETS.super35` | `{24.89, 18.66}` mm | Sensor preset |
| `SENSOR_PRESETS.apsC` | `{23.6, 15.6}` mm | Sensor preset |
| `SENSOR_PRESETS.mft` | `{17.3, 13}` mm | Sensor preset |
| `K_full` / `K_cheap` | `0.02` / `0.008` | `bokehScale` gain (V2) |
| `MAX_full` / `MAX_cheap` | `8` / `3` | `bokehScale` clamp (V2) |
| `DEFAULT_CAMERA_LENS` | 50 mm, f/4, `focusDistance` 3, `autofocus` false, `fullFrame`, `near` 0.01, `far` 100 | New camera and Default preset lens |
| `CONCERT_FOCAL_LENGTH_MM` | 85 | Concert preset lens (V1) |

## R — Requirements

### Lens math (Task 1)

R1. `SensorPresetId = 'fullFrame' | 'super35' | 'apsC' | 'mft'` and `SENSOR_PRESETS` give each preset's width/height in millimetres and a label, per the Constants table.
R2. `verticalFovDegrees(focalLengthMm, sensorHeightMm)` = `2 * atan((sensorHeightMm / 2) / focalLengthMm) * (180 / π)`. `focalLengthMmFromVerticalFov(fovDegrees, sensorHeightMm)` is its inverse, with the input FOV clamped to `(1, 179)` before convert. The two round-trip within floating-point tolerance.
R3. `filmGaugeMm(preset)` returns `SENSOR_PRESETS[preset].widthMm` (three.js `filmGauge` is the sensor width when aspect is at least 1).
R4. `bokehScale(focalLengthMm, fStop, quality)` follows V2. A wider aperture (lower f-stop) gives a larger result; `'cheap'` gives a result no larger than `'full'` at the same inputs.
R5. `dofFocalRangeWorld(focusDistance, fStop, quality)` follows V3 and returns a world-unit value, never a millimetre value.
R6. `concertFocalLengthMm()` returns `85` (V1); its vertical FOV on Full Frame is under 35°.
R7. `lens-math.ts` has no three.js import. `packages/contracts/test/lens-math.test.ts` covers R2 to R6 with the plan's example assertions as the floor, not the ceiling, of coverage.

### Lens schema, defaults, migrate (Task 2)

R8. `CameraLens` gains `focalLengthMm` (12-300), `fStop` (1-32), `focusDistance` (> 0, finite), `autofocus` (boolean), `sensorPreset` (the R1 enum), alongside the existing `fovDegrees` (1-179) and `near` / `far` (`far > near`, unchanged).
R9. `DEFAULT_CAMERA_LENS` is 50 mm, f/4, `focusDistance` 3, `autofocus` false, `sensorPreset` `'fullFrame'`, `fovDegrees` computed from R2, `near` 0.01, `far` 100.
R10. `normalizeLens(input)` accepts a legacy `{fovDegrees, near, far}` object and fills the physical fields through a Full Frame convert (D12); it accepts a full physical object and recomputes `fovDegrees` from the physical fields before returning, so the two never silently disagree.
R11. `lensWithFocalLength(lens, mm)` and `lensWithFovDegrees(lens, fov)` each return a new lens with both `focalLengthMm` and `fovDegrees` in sync for the lens's current sensor; neither mutates its input.
R12. `LensSchema.parse` accepts both the legacy and the full shape and yields the full shape (D12), using `z.preprocess` or an equivalent refine so `setCameraLens` can accept either on the wire. Rust `Lens` mirrors the same fields and ranges, with shared accept/reject vectors for the legacy-to-physical migrate, in `fixtures/protocol/validation-vectors.json`.
R13. A document that previously held only `{fovDegrees, near, far}` opens without error and without a framing change beyond the documented Full Frame convert of R10; it does not keep its exact prior bytes once normalized, per D12, but it does not need a schema-version bump because no existing required field drops or narrows.

### Look-stack effect groups (Task 3)

R14. `CameraEffectsSchema` gains `depthOfField: { enabled, highQuality, focusSpeed }`, default `{ enabled: false, highQuality: true, focusSpeed: 0.35 }` (focusSpeed 0-1).
R15. `CameraEffectsSchema` gains `lensFlare: { enabled, highQuality, threshold, intensity }`, default `{ enabled: false, highQuality: true, threshold: 0.5, intensity: 1 }` (threshold 0-1, intensity 0-4).
R16. `CameraEffectsSchema` gains `anamorphicFlare: { enabled, highQuality, intensity, spread, vertical }`, default `{ enabled: false, highQuality: true, intensity: 0.5, spread: 0.5, vertical: false }`.
R17. `CameraEffectsSchema` gains `filmGrain: { enabled, intensity }`, default `{ enabled: false, intensity: 0.15 }` (intensity 0-1).
R18. Each new group is optional, following the existing B37 groups; a camera without any of the four new groups keeps its prior serialized shape (Rust `skip_serializing_if`, same as `lensDirt` / `vignetting` / etc.). `DEFAULT_CAMERA_EFFECTS` extends to cover all nine groups, frozen.
R19. Rust mirrors the four new groups and their `Validate` ranges; accept/reject vectors cover each group's default, its range edges, and one rejected value per numeric field.

### Property registry and FOV convert (Task 4)

R20. `PROPERTY_KEYS` gains `focalLengthMm`, `fStop`, `focusDistance`, `autofocus`, `sensorPreset`, next to the existing `fovDegrees`.
R21. Writing `fovDegrees` calls `lensWithFovDegrees` (D4); writing `focalLengthMm` calls `lensWithFocalLength`; writing `sensorPreset` keeps `focalLengthMm` and recomputes `fovDegrees` from it; writing `autofocus` sets the boolean directly. An out-of-range write for any of the five keys fails with the registry's existing invalid-input behavior and leaves the scene unchanged, matching how other range-checked keys fail today.
R21a. A Blueprint write of any lens key (`fovDegrees` or one of the five keys) commits through `setCameraLens` after the idle time. A `setCameraLens` patch cancels the overrides and transitions of all lens keys of that camera.
R21b. A `setCameraLens` write that keeps the current `focalLengthMm` and `sensorPreset` but has a different `fovDegrees` converts through `lensWithFovDegrees` (D4), so an MCP write of only the FOV is not lost. Any other write keeps its physical fields and recomputes `fovDegrees` from them (D12). The patch schema keeps the written `fovDegrees` (`LensWriteSchema`); the session resolves it against the current lens (`resolveLensWrite`).
R22. Reading any of the five keys, or `fovDegrees`, returns the stored lens's synced value — never a value computed from a different sensor than the one stored.
R23. Existing callers that still write a bare `{fovDegrees, near, far}` lens literal (`compile-scene.ts`, `blueprint-templates/index.ts`, `warudo-show.ts`) keep working unchanged at the call site; the schema-level normalize of R10 is what gives them physical fields. Task 9 may update call sites directly where that is the cheaper fix, but this requirement does not force it.

### Apply physical lens on the Three camera (Task 5)

R24. `applyPerspectiveLens(camera, lens)` sets `camera.filmGauge` from `filmGaugeMm(lens.sensorPreset)`, calls `camera.setFocalLength(lens.focalLengthMm)`, sets `camera.near` / `camera.far`, then sets `camera.fov = lens.fovDegrees` (V4), then calls `updateProjectionMatrix()`.
R25. `renderer.ts`'s perspective camera construction and `screenshot.ts`'s offscreen `PerspectiveCamera` construction each call `applyPerspectiveLens` instead of writing `camera.fov` directly.
R26. `packages/renderer/test/lens.test.ts` asserts that after `applyPerspectiveLens`, `camera.fov` is within 0.1° of `lens.fovDegrees` at an aspect ratio of 16/9, and the test's comment records the V4 choice so a future reader does not "fix" it back to three.js's own FOV-from-focal-length result.

### Post chain — DoF, flare, anamorphic, film (Task 6)

R27. `lookChainKey(effects, quality)` rebuilds its string only when an `enabled` or `highQuality` flag changes, or the quality tier changes; numeric params never appear in the key. `needsLook(effects)` is `true` only while at least one of `depthOfField.enabled`, `lensFlare.enabled`, `anamorphicFlare.enabled`, `filmGrain.enabled` is `true`; it is `false` for `DEFAULT_CAMERA_EFFECTS` and for the Default preset's effects.
R28. The chain order follows D10: scene pass, haze, beams, **depth of field**, bloom, **lens flare**, **anamorphic smear**, lens dirt, grade / tonemap, **film grain**, the existing stylized effects (vignette / night vision / blur / pixelate), display transform, FXAA.
R29. The `DepthOfFieldNode` call passes `dofFocalRangeWorld(...)` (world units, R5) into the node's `focalLength` slot and `bokehScale(...)` into its `bokehScale` slot; `focalLengthMm` is never passed into that slot. A code comment at the call site names this unit mismatch so a future edit cannot silently reintroduce it.
R30. `quality === 'cheap'` (the preview tier) lowers the DoF bokeh/range inputs, the flare downsample, and the anamorphic tap count; it never sets any of the four `enabled` flags to `false` (D5).
R31. `needsChain` and `chainKey` take the look key (R27) as an added parameter, after the existing B37 effects key, with a default of `''` that reproduces every prior result unchanged. Toggling a look flag rebuilds the chain; a number-only change inside an already-active look group updates a uniform only.
R32. The premultiplied-alpha composite rule already in place for bloom and lens dirt (`rgb' = rgb + add.rgb`, `a' = a + (1 − a) · saturate(max(add.rgb))`) stays valid through DoF, lens flare, and the anamorphic smear, so transparent OBS output does not gain a grey veil or a wrong alpha.
R33. With all four new groups at their defaults (every `enabled: false`), the built chain's node graph is identical to the chain built before this work; `needsLook` being `false` is what guarantees this.

### Autofocus on the Focus Character head (Task 7)

R34. `smoothFocusDistance(current, target, focusSpeed, dtSeconds)` = `current + (target - current) * (1 - (1 - focusSpeed) ** (dtSeconds * 60))`, so `focusSpeed` 0 holds `current` and `focusSpeed` 1 snaps to `target` in one frame.
R35. Autofocus resolves the Focus Character from the camera's `navigation.orbitCharacter.targetId` (the #168 pattern); head position is the VRM humanoid head bone's world position when present, else the avatar root plus `(0, 1.5, 0)`.
R36. While `autofocus` is `true` and a Focus Character target resolves, each frame writes the smoothed distance (R34) into the live focus distance that feeds DoF and the Inspector readout. While no target resolves, the stored `focusDistance` does not change, and the autofocus control itself needs no added helper text to explain why (constitution principle 1). The distance is measured from the camera position that is drawn, including an orbit drag that has not committed. A screenshot of the output camera uses the same smoothed distance; a screenshot of another autofocus camera uses its current target distance.

### Inspector, presets, authoring defaults (Task 8)

R37. The Lens Inspector section shows: focal length (mm), f-stop, focus distance, autofocus, sensor preset, a read-only FOV readout, near, far, and a "Reset lens" action — replacing the current bare FOV slider.
R38. `applyLensPreset(name)` returns `{ lens, effects?, grading? }` for `'default' | 'portrait' | 'wide' | 'cinematic' | 'concert'`, matching the design's preset table: Default (50 mm, f/4, Full Frame, DoF/flare/smear/grain off); Portrait (85 mm, f/1.8, autofocus on, DoF on); Wide (24 mm, f/2.8, DoF off); Cinematic (35 mm, f/2, mild film grain, mild vignette, documented ACES grading — the one preset allowed to also set `grading`); Concert (85 mm per V1, effects at Default-equivalent, performance-safe).
R39. A new camera and the first-run show use the Default preset's lens (D7); `authoring.ts`'s current hardcoded `fovDegrees: 40` for a new camera is replaced so a new camera opens at `DEFAULT_CAMERA_LENS`, not at an ad hoc FOV.
R40. A preset apply is one undoable commit through the existing revision/commit path, matching how other Inspector field groups commit.
R41. The autofocus control adds no helper copy for the no-target case (R36); no new badge or empty state appears anywhere in the Lens or Effects sections (constitution principles 1 and 2).

### Import paths and fixture cameras (Task 9)

R42. Every lens-construction site found by the Task 9 grep (`packages/assist/src/compile-scene.ts`, `packages/contracts/src/blueprint-templates/index.ts`, `apps/desktop/src/blueprints/templates.ts`, `scripts/warudo-show.ts`, and any smoke or fixture show camera) either passes through `normalizeLens` / `DEFAULT_CAMERA_LENS` / `lensWithFovDegrees`, or is recorded in the task's commit message as an intentional legacy-parse-only path. No site is left silently unexamined.
R43. The full existing test suite (`pnpm test:unit` or the project's equivalent) passes after the Task 9 changes; a failure traced to the new Lens shape is fixed at its fixture, not by weakening `LensSchema`.

### Docs, parity, evidence (Task 10)

R44. `ARCHITECTURE.md` describes the physical lens fields and the Task 6 post-chain order (D10) in the renderer's output-path section.
R45. `docs/warudo-parity.md` marks depth of field, lens flare, and film grain as partial (not "complete") until OBS evidence lands, and does not claim DoF aperture parity with Warudo until the VM check of D6 runs.
R46. The PR's evidence set includes: an Inspector screenshot of the Default preset and of the Portrait preset; one still showing visible DoF / bokeh; one still showing flare (with a note on whether the anamorphic smear is visible); and a short note on WebGPU versus WebGL 2 behavior and OBS alpha, captured during QA rather than written in advance (constitution principles 5 and 15).
R47. `direnv exec . cargo sweep --time 7` runs from the worktree once the feature work finishes, per the `AGENTS.md` shared-Cargo-target rule.

## E — Entities

- `packages/contracts/src/lens-math.ts`: `SensorPresetId`, `SENSOR_PRESETS`, `verticalFovDegrees`, `focalLengthMmFromVerticalFov`, `filmGaugeMm`, `bokehScale`, `dofFocalRangeWorld`, `concertFocalLengthMm`.
- `packages/contracts/src/schema.ts` / `types.ts`: extended `LensSchema` / `CameraLens` (TypeScript); `DEFAULT_CAMERA_LENS`, `normalizeLens`, `lensWithFocalLength`, `lensWithFovDegrees` (new `lens.ts` or folded into `lens-math.ts`).
- Rust `crates/contracts/src/lib.rs`: extended `Lens` struct and its `Validate` impl; shared fixtures in `fixtures/protocol/validation-vectors.json`.
- `packages/contracts/src/camera-effects.ts`: `CameraDepthOfFieldSchema`, `CameraLensFlareSchema`, `CameraAnamorphicFlareSchema`, `CameraFilmGrainSchema`; extended `CameraEffectsSchema` and `DEFAULT_CAMERA_EFFECTS`. Rust mirrors in `lib.rs`.
- `packages/contracts/src/property-registry.ts`: five new `PropertyKey` entries and their read/write cases.
- `packages/renderer/src/lens.ts`: `applyPerspectiveLens`.
- `packages/renderer/src/lens-look.ts`: `lookChainKey`, `needsLook`, `createLensLook` (`update`, `applyDoF`, `takeBloom`, `applyFlareAndSmear`, `applyFilm`, `dispose`).
- `packages/renderer/src/autofocus.ts`: `smoothFocusDistance`, head resolution helper.
- `packages/renderer/src/post-chain.ts`: `needsChain` / `chainKey` with the added look-key parameter; `build` with the new stages in D10 order.
- `apps/desktop/src/editor/lens-presets.ts`: `applyLensPreset` and the five named preset payloads.
- Modified, not newly created: `CameraLensFields.svelte`, the camera effects field component(s), `authoring.ts`, `live-fields.ts`, `property-defaults.ts`, `slider.ts`, `renderer.ts`, `screenshot.ts`.
- No new `PatchOp`, no new entity kind, no new quality profile, no new MCP tool — `setCameraLens` and `setCameraEffects` already exist and carry the new fields.

## A — Approach

One implementation pass on `feat/camera-lens-343` (D8, approach C). Contracts first (pure lens math, then schema and migrate, then the four effect groups, then the property registry), each with its own failing-test-first step. Then the renderer (apply-to-camera, then the post-chain stages, then autofocus). Then the Inspector and presets. Then the import-path sweep. Then documents and the evidence checklist. Internal commits land in that order inside the one PR, each gated on its own task's tests passing before the next task starts.

## S — Structure

| Area | Create | Modify |
| --- | --- | --- |
| Lens math | `packages/contracts/src/lens-math.ts`, `packages/contracts/test/lens-math.test.ts` | — |
| Lens schema | — | `packages/contracts/src/schema.ts`, `types.ts`, `index.ts`; Rust `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json` |
| Effects | — | `packages/contracts/src/camera-effects.ts`, `camera-effects.test.ts`; Rust camera effects |
| Registry | — | `packages/contracts/src/property-registry.ts` and its tests |
| Renderer apply | `packages/renderer/src/lens.ts`, `test/lens.test.ts` | `renderer.ts`, `screenshot.ts` |
| Post stack | `packages/renderer/src/lens-look.ts`, `test/lens-look.test.ts` | `post-chain.ts` |
| Autofocus | `packages/renderer/src/autofocus.ts`, `test/autofocus.test.ts` | renderer frame update |
| Editor | `apps/desktop/src/editor/lens-presets.ts`, `lens-presets.test.ts` | `CameraLensFields.svelte`, camera effects UI, `authoring.ts`, `live-fields.ts`, `property-defaults.ts`, `slider.ts` |
| Imports / fixtures | — | `scripts/warudo-show.ts`, `packages/assist/src/compile-scene.ts`, `blueprint-templates/index.ts`, `apps/desktop/src/blueprints/templates.ts`, fixture shows |
| Docs | this analysis + this contract | `ARCHITECTURE.md`, `docs/warudo-parity.md` |

## O — Operations

1. Task 0 (this contract): analysis, REASONS prompt, commit with the design and plan docs.
2. Task 1: pure lens math (R1-R7).
3. Task 2: lens schema, defaults, migrate, TypeScript and Rust (R8-R13).
4. Task 3: the four new effect groups, TypeScript and Rust (R14-R19).
5. Task 4: property registry and FOV convert writes (R20-R23).
6. Task 5: apply the physical lens to the Three perspective camera (R24-R26).
7. Task 6: post-chain stages for DoF, flare, anamorphic smear, film grain (R27-R33).
8. Task 7: autofocus on the Focus Character head (R34-R36).
9. Task 8: Inspector controls, named presets, authoring defaults (R37-R41).
10. Task 9: sweep legacy lens-construction call sites (R42-R43).
11. Task 10: docs, parity checklist, evidence, `cargo sweep` (R44-R47).

Each task keeps the plan's own failing-test, implement, pass, commit cycle; this contract does not restate those steps and instead gives the requirement each step must satisfy.

## N — Norms

- Unit tests for the pure lens math (R1-R7), the schema migrate (R8-R13), the effect-group ranges (R14-R19), the registry convert (R20-R23), the camera-apply round-trip (R24-R26), the look-chain key and `needsLook` (R27, R31), autofocus smoothing (R34), and the preset payloads (R38). No test for static UI copy.
- Functional TypeScript and plain data; a code comment appears only where the DoF unit mismatch (R29) or another non-obvious conversion needs one.
- Controls come from `@oshi-connect/ui` and the existing field components; no second primitive kit.
- Long prose (this contract, the PR text, the parity updates) is Simplified Technical English. UI copy stays label-only.
- Browser-check the changed Lens and Effects Inspector sections before Task 8 is called done (constitution principle 15).

## S — Safeguards

- Do not let transparent OBS output gain a grey veil, a wrong alpha, or a broken premultiplied bloom composite (R32).
- Do not let the Default preset or a new camera render soft from DoF turned on by mistake (R9, R39).
- Do not let an old show or Blueprint that writes `fovDegrees` silently no-op or drift its framing beyond the documented Full Frame convert on every load (R10, R13, R21).
- Do not let the WebGL 2 fallback hard-crash with the new chain when its effects are off; it must still draw with them on (R33, Task 6 evidence).
- Do not pass `focalLengthMm` into `DepthOfFieldNode`'s world-unit `focalLength` slot (R29).
- Do not add `EffectComposer`, `UnrealBloomPass`, `BokehShader2`, `FilmShader`, or the project's removed `AnamorphicNode`.
- Do not add continuous image readback, a JPEG/PNG encode, or an image stream through Tauri IPC to the production output path.
- Do not add helper text, a badge, or an empty state that only repeats what a control already shows (R36, R41).
- Do not claim Warudo DoF aperture parity, or mark DoF / flare / film grain "complete" in the parity doc, before the VM check and the OBS evidence land (R45-R46).
- Do not split this work across more than one PR; internal commits follow the Task 0-10 order inside the one PR (D8).
