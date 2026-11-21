# Analysis: Physical camera lens, presets, and TSL look stack

Date: 2026-11-21. Scope: issue [#343](https://github.com/danirukun/opensekai/issues/343). Contract: [physical camera lens](../prompt/2026-11-21-camera-physical-lens.md). Design: [camera physical lens design](../../docs/superpowers/specs/2026-11-21-camera-physical-lens-design.md). Plan: [camera physical lens plan](../../docs/superpowers/plans/2026-11-21-camera-physical-lens.md). Related: #54 (grading / bloom; LUTs stay there), #55 (AO / CA stay there; this work covers the DoF / flare slice), #172 (B37 vignette / dirt; this work composes with it), #49 (FOV UI; this work replaces it), #56 (quality budget), #168 / #340 (Focus Character / first-run Default), #68 / #169 (out of scope).

## Request

Issue #343 asks for a photographer-style lens on each perspective camera (focal length, f-stop, focus distance, autofocus, sensor preset) in place of a plain FOV slider, with named look presets, and a TSL look stack (depth of field, bloom-fed lens flare, an anamorphic smear, film grain). The design sets Full Frame 36×24 mm as the default sensor and asks for Warudo-level parity on DoF, bloom, flare, vignette, and ACES / grading composition, while going past Warudo by storing a physical lens as the primary control instead of FOV.

## Sources

| Source | What it gives | Status |
| --- | --- | --- |
| `docs/superpowers/specs/2026-11-21-camera-physical-lens-design.md` | The owner decisions, data model, post-chain order, preset table, and acceptance criteria | Read on 2026-11-21 |
| `docs/superpowers/plans/2026-11-21-camera-physical-lens.md` | Task 0 to Task 10, file map, interfaces, and the three.js `DepthOfFieldNode` unit-mismatch warning | Read on 2026-11-21 |
| `packages/contracts/src/schema.ts:132-136` | Today's `LensSchema`: `fovDegrees` (1-179), `near`, `far` (strict object, `far > near`) | Read |
| `packages/contracts/src/property-registry.ts:7,24,69,86` | `fovDegrees` is a registry key; read returns `entity.lens.fovDegrees`; write replaces `lens.fovDegrees` directly, with no sensor convert | Read |
| `crates/contracts/src/lib.rs:190-191,2744-2745` | Rust mirrors `Lens { fov_degrees: f64, … }` with the same 1-179 range; no physical fields yet | Read |
| `packages/contracts/src/camera-effects.ts` | Today's `CameraEffectsSchema`: `lensDirt`, `vignetting`, `nightVision`, `blur`, `pixelate` (B37, #172). Pattern to extend, not replace | Read |
| `packages/renderer/src/post-chain.ts:17,19,57-58,77,82-84` | `needsChain` / `chainKey` already take an `effects` key string; chain order today is scene pass, haze, beams, bloom (inside `grading.ts`), lens dirt, grade / tonemap, stylized `CameraEffectsSchema` effects, display transform, optional FXAA | Read |
| `apps/desktop/src/editor/authoring.ts:26` | New camera today gets `lens: { fovDegrees: 40, near: .01, far: 100 }` — a hardcoded FOV, not a Full Frame 50 mm lens | Read |
| `packages/assist/src/words.ts:25-29`, `compile-scene.ts:96` | The chat-assist framing words set `fovDegrees` directly; no sensor or focal length today | Read |
| `scripts/warudo-show.ts:48` | Warudo import writes `{fovDegrees, near, far}` only from the Warudo `FieldOfView` port | Read |
| three.js 0.187.0 source (`examples/jsm/tsl/display/`) | `DepthOfFieldNode` signature `dof(color, viewZ, focusDistance, focalLength, bokehScale)`; its `focalLength` slot is a world-unit focus range, not millimetres | Read |

## Current state

- **Lens data.** `LensSchema` (TypeScript) and `Lens` (Rust) store only `fovDegrees`, `near`, `far`. No focal length, f-stop, focus distance, autofocus, or sensor. `camera.lens.fovDegrees` is the one control for framing.
- **Property registry.** `fovDegrees` is a flat `PropertyKey`. A write replaces `lens.fovDegrees` with no other change, so Blueprint tweens and MCP `scene_patch` can set FOV directly today. Any new write path must keep this working while adding a sensor convert.
- **Inspector.** `CameraLensFields.svelte` shows FOV, Near, Far. `property-defaults.ts` reads `fovDegrees`, `near`, `far` into the panel. `authoring.ts` gives a new camera `fovDegrees: 40`, a value the physical-lens Default (50 mm, Full Frame, about 27° vertical) will replace.
- **Post chain.** `post-chain.ts` builds one TSL `PostProcessing` chain: scene pass, optional haze, optional stage beams, bloom (inside the grading block), lens dirt, grade / tonemap, the B37 stylized effects (vignette, night vision, blur, pixelate), display transform, optional FXAA. `needsChain` and `chainKey` already accept an `effects` key string from `camera-effects.ts`, so the pattern for a new effect group (build once, then uniforms-only on a number change) is in place.
- **Camera effects schema.** `CameraEffectsSchema` (`packages/contracts/src/camera-effects.ts`) is a `z.strictObject` of optional groups, each with its own `enabled` (or `assetId`) flag; `DEFAULT_CAMERA_EFFECTS` is a frozen object with one default per group. This is the same shape the design asks for `depthOfField`, `lensFlare`, `anamorphicFlare`, `filmGrain` to join.
- **Other lens writers.** `packages/assist/src/compile-scene.ts`, `blueprint-templates/index.ts`, `apps/desktop/src/blueprints/templates.ts`, and `scripts/warudo-show.ts` each construct or read a `{fovDegrees, near, far}` lens literal. Each is a site Task 9 must pass through `normalizeLens` / `DEFAULT_CAMERA_LENS` so a legacy or chat-assist lens still opens with physical fields.
- **Missing today:** physical lens fields, sensor presets, named presets, depth of field, lens flare, anamorphic smear, film grain. Bloom, tonemap, grading, vignette, night vision, blur, pixelate, and dirt already work, including the premultiplied-alpha path for transparent OBS.

## Decisions

### Owner (2026-11-21)

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D1 | Default sensor is Full Frame 36×24 mm for new cameras and for Default. three.js's implicit 35 mm `filmGauge` default is never left standing | Keep three.js's default film gauge |
| D2 | Ship the TSL `FilmNode` for film grain in this issue; off by default; mild on Cinematic only | Defer grain to a later issue |
| D3 | Flare is `LensflareNode` on the bloom buffer **and** a separate Warudo-like anamorphic smear; each can turn off on its own | One combined flare toggle |
| D4 | `fovDegrees` stays writable. A write converts through the camera's current sensor into `focalLengthMm`; `fStop` does not change | Make `fovDegrees` read-only once the physical lens ships |
| D5 | Preview quality cheapens DoF, flare, and anamorphic (lower taps / resolution / bokeh scale); it never force-disables them | Preview forces the new effects off |
| D6 | The UI keeps a real f-stop. A documented heuristic maps f-stop and focal length to `DepthOfFieldNode`'s `bokehScale` and world-unit focus range. No Warudo DoF parity claim before a VM check of Warudo's unitless "aperture" | Reverse-engineer a bit-exact Warudo DoF match without the VM check |
| D7 | Depth of field stays off (`enabled: false`) on the Default preset and on every new camera, so first-run framing stays sharp (#340) | DoF on by default with a conservative bokeh |
| D8 | One implementation pass, one PR, approach C: contracts, renderer, and inspector land together on `feat/camera-lens-343`; internal commits still follow contract → renderer → UI order for review | Phase the work into several smaller PRs (approach A or B) |

### Integrator (2026-11-21, this contract)

| # | Decided | Rejected alternative |
| --- | --- | --- |
| D9 | `depthOfField`, `lensFlare`, `anamorphicFlare`, and `filmGrain` nest inside the existing `CameraEffectsSchema`, next to `lensDirt` / `vignetting` / `nightVision` / `blur` / `pixelate`, so they share one `setCameraEffects` patch and one Inspector "Effects" section rather than a second panel | A new top-level `lensLook` schema and a second patch operation |
| D10 | Post-chain order places DoF before bloom, flare and the anamorphic smear after bloom (both read the bloom buffer), film grain after lens dirt / grade, ahead of the existing stylized effects | DoF after bloom; grain before grade |
| D11 | Pure lens and DoF-heuristic math lives in one new contracts module (`lens-math.ts`), with no three.js import, mirroring the `camera-effects-math.ts` pattern from B37 | Inline the formulas in the renderer module only |
| D12 | Ten tasks map one-to-one onto this contract's requirement groups (R1-R10 below); each task keeps its own failing-test-first step and its own commit, inside the one PR of D8 | One monolithic task |

## Chain order with this change

Bloom stays inside the grading block (unchanged from B37/#172). The physical-lens chain adds depth of field before bloom, and reads the bloom buffer twice (flare, then the anamorphic smear) after it:

scene pass, haze, beams, **depth of field**, bloom, **lens flare**, **anamorphic smear**, lens dirt, grade / tonemap, **film grain**, stylized effects (vignette / night vision / blur / pixelate), display transform, FXAA.

## Interpretations (reversible)

The design marks these as tuned-during-implementation; this contract records the chosen starting value so Task 1 and Task 5 do not stall on an open number. The owner can change each one in review.

| # | Chosen | Alternative |
| --- | --- | --- |
| V1 | Concert preset uses an 85 mm focal length on Full Frame, giving about 16° vertical FOV (under the design's 35° ceiling) | A longer focal length with a narrower FOV margin |
| V2 | `bokehScale(focalLengthMm, fStop, quality)` heuristic: `clamp((focalLengthMm / fStop) * K, 0, MAX)`, with `K_full = 0.02`, `K_cheap = 0.008`, `MAX_full = 8`, `MAX_cheap = 3` | A lookup table keyed on named f-stops |
| V3 | `dofFocalRangeWorld` (the DoF node's world-unit `focalLength` slot) starts at `max(0.05, focusDistance * (fStop / 32) * (cheap ? 1.5 : 1))` | A fixed range independent of f-stop |
| V4 | `applyPerspectiveLens` sets `filmGauge` and `setFocalLength` for DoF and sensor consumers, then sets `camera.fov = lens.fovDegrees` directly so the Inspector's stored FOV readout matches the rendered frame at any aspect ratio | Let three.js's own FOV-from-focal-length result stand, and resync stored `fovDegrees` to it on apply |
| V5 | Anamorphic smear parameters (intensity, spread, vertical/horizontal) approximate Warudo's ZH smear as far as one small TSL pass allows; the result is not bit-identical to the project's removed `AnamorphicNode` | Match Warudo exactly, including its removed-node math |

## Risks

- **DoF node unit mismatch.** `DepthOfFieldNode`'s `focalLength` parameter is a world-unit focus range, not millimetres. Task 5 and Task 6 must pass `dofFocalRangeWorld(...)`, never `focalLengthMm`, into that slot. The plan's Review Focus item 1 already flags this; this contract keeps it as a named risk so a later task cannot drop it silently.
- **OBS alpha.** DoF, flare, and the anamorphic smear each touch the colour buffer before or around the existing bloom composite. Any of the three can break the premultiplied-alpha rule that keeps transparent OBS correct. Task 6 must prove the composite still holds with each new effect on.
- **First-run sharpness.** `authoring.ts:26` hardcodes `fovDegrees: 40` today. Task 8 must replace it with `DEFAULT_CAMERA_LENS` (Full Frame, 50 mm, DoF off), or #340 regresses silently.
- **Legacy and chat-assist lenses.** `compile-scene.ts`, `blueprint-templates/index.ts`, and `warudo-show.ts` each write a bare `{fovDegrees, near, far}` lens. `normalizeLens` must accept that shape without drifting framing beyond the documented Full Frame convert.
- **WebGL 2 fallback.** The new effects must not hard-crash the WebGL 2 chain when off, and must still draw (possibly cheapened) when on. No local check in this task; Task 6 and Task 10 carry the evidence.
- **No Warudo DoF parity claim yet.** Warudo's aperture control is unitless in its UI. `docs/warudo-parity.md` must not claim DoF parity until a VM check records what that number maps to.

## Out of scope

- Handheld camera (#169) and the Director virtual-camera switcher (#68).
- Ambient occlusion and chromatic aberration (#55) — this slice leaves chain slots only.
- LUT textures (#54).
- Chroma key, transparent-background policy, multi-camera outputs (#52, #50, #170).
- Orthographic camera lens UI (orthographic cameras keep their current, separate path).
- A second quality system beyond #56; each new effect gets a per-effect high-quality flag only.
- `EffectComposer`, `UnrealBloomPass`, `BokehShader2`, `FilmShader`, and the project's removed `AnamorphicNode`.
- Exact Default `focusDistance` tuning and the final bokeh-heuristic constants — V2 and V3 above are the starting values; Task 1 and Task 8 may tune them, with the VM check before any parity claim.
