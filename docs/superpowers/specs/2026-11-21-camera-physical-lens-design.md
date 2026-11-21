# Physical camera lens, presets, and TSL look stack

Date: 2026-11-21. Status: draft for owner review. Issue: [#343](https://github.com/danirukun/opensekai/issues/343). Related: #54 (grading/bloom exist; LUTs stay there), #55 (AO/CA stay there; this work covers DoF/flare slice), #172 (vignette/dirt compose), #49 (FOV UI replaced), #56 (quality budget), #168 / #340 (Focus Character / first-run Default), #68 / #169 (out of scope).

## Intent

Give each perspective camera photographer-style controls: focal length (mm), f-stop, focus distance, autofocus on the Focus Character head, and sensor presets. Show FOV as a derived readout. Add named look presets. Extend the existing TSL post chain with depth of field / bokeh, lens flare from bloom, a Warudo-like anamorphic smear, and film grain. Match Warudo at least for DoF, bloom, flares, vignette, and ACES / grading composition. Go past Warudo on framing by storing a physical lens instead of FOV as the primary control.

## Current state

- Renderer: `WebGPURenderer` from `three/webgpu` with `forceWebGL` fallback. Shared TSL graph. Post path is `PostProcessing` plus `pass()` nodes in `packages/renderer/src/post-chain.ts`, not `EffectComposer`. three.js **0.187.0**.
- Chain order today: scene pass, optional haze, optional stage beams, bloom (`BloomNode` in `grading.ts`), lens dirt, color grade / tone mapping, stylized camera effects (`CameraEffectsSchema`), display transform, optional FXAA. Premultiplied-alpha bloom for transparent OBS.
- Inspector Lens: FOV (°) plus Near / Far (`CameraLensFields.svelte`, `LensSchema`: `fovDegrees`, `near`, `far`). Blueprints and MCP expose `fovDegrees` (`property-registry.ts`).
- Already present: bloom, tonemap, grading; vignette, lens dirt, night vision, blur, pixelate. Missing: physical lens, presets, DoF / bokeh, lens flare, anamorphic smear, film grain.

## Decisions (owner, 2026-11-21)

| Topic | Decision |
| --- | --- |
| Default sensor | Full Frame **36×24 mm** for new cameras and Default |
| Film grain | Ship TSL `FilmNode` in this issue; off by default; mild on Cinematic |
| Flare | `LensflareNode` **and** Warudo-like anamorphic smear from bloom |
| `fovDegrees` writes | Keep writable; convert through current sensor → `focalLengthMm` |
| Preview quality | **Cheapen** DoF / flare / anamorphic; do not force off |
| DoF ↔ Warudo aperture | Real f-stop in UI; heuristic map to `DepthOfFieldNode`; verify on VM before parity claims |
| Delivery | **One implementation pass** (contracts + renderer + inspector together), approach C |

## Goals

1. Persist and edit physical lens fields; derive FOV; apply with `PerspectiveCamera.setFocalLength` / `filmGauge` (or equivalent tested against that API).
2. Named presets: Default, Portrait, Wide, Cinematic, Concert. New cameras and first-run use Default. Apply is undoable.
3. DoF via TSL `DepthOfFieldNode`, driven by focus (or autofocus) and the physical lens; off in Default; can turn off elsewhere.
4. Lens flare via TSL `LensflareNode` on the bloom buffer; anamorphic smear as separate enable; both can turn off.
5. Film grain via TSL `FilmNode`; can turn off.
6. Existing bloom, grading, vignette, and dirt keep working, including transparent OBS.
7. Blueprints and MCP expose the new fields; `fovDegrees` convert path preserves old shows and FOV tweens.
8. Default with expensive effects off stays usable at 1080p60 on WebGPU and WebGL 2.

## Non-goals

- Handheld camera (#169), Director virtual-camera switcher (#68).
- Ambient occlusion and chromatic aberration (#55) — leave chain slots only.
- LUT textures (#54) — leave for that issue.
- Chroma key, transparent background policy, multi-cam outputs (#52, #50, #170).
- Orthographic physical lens UI (orthographic keeps a separate path).
- A second quality system beyond #56 / per-effect high-quality flags.
- `EffectComposer`, `UnrealBloomPass`, `BokehShader2`, `FilmShader`.

## Anti-goals

The work fails if:

- Transparent OBS gains a gray veil, wrong alpha, or broken premultiplied bloom.
- Default / first-run camera is soft from DoF on by mistake (#340).
- Old shows or blueprints that write `fovDegrees` silently no-op or drift framing on every load.
- WebGL 2 fallback cannot run the new chain without a hard crash when effects are off.

## Constraints

- One authoritative simulation; renderers consume evaluated state. No continuous image readback through Tauri IPC on the production output path.
- Schema: optional new fields; old shows open with defaults / one-time FOV→focal migrate on load.
- Long prose in ASD-STE100. UI copy stays short (constitution principle 1).
- Shared Cargo target and `direnv exec` rules for Rust builds stay as in `AGENTS.md`.

## Approaches

| | Approach | Trade-off | Result |
|---|---|---|---|
| A | One design, phased slices (schema → framing → DoF → flare/grain → presets) | Clearer review; longer calendar | Rejected by owner |
| B | Framing only now; look stack later | Smaller first PR; splits #343; incomplete presets | Rejected |
| C | Full stack in one implementation pass | Harder review/rebase on `post-chain.ts`; one complete look | **Selected** |

## Design

### Data model — lens

Perspective camera `lens` stores:

| Field | Range (guide) | Default |
| --- | --- | --- |
| `focalLengthMm` | about 24–200 | **50** |
| `fStop` | about 1.4–16 | **4** |
| `focusDistance` | scene units > 0 | far enough that Default stays sharp |
| `autofocus` | boolean | false on Default; true on Portrait when a Focus Character exists |
| `sensorPreset` | `fullFrame` \| `super35` \| `apsC` \| `mft` | **`fullFrame`** |
| `near` / `far` | as today | unchanged |

Sensor presets set film/sensor size for three.js `filmGauge` (Full Frame 36×24 mm). Do not leave the three.js 35 mm default implicit.

**Derived:** vertical `fovDegrees` from focal length and sensor. Persist physical fields so a saved show does not drift when aspect ratio changes.

**`fovDegrees` write:** convert through the current sensor into `focalLengthMm`; leave `fStop` unchanged.

**Load migrate:** if a document has only `fovDegrees`, convert once through Full Frame (or stored sensor if already present) into `focalLengthMm`, then persist physical fields on later saves.

**Orthographic:** physical lens controls do not apply.

### Data model — new effects

Extend `CameraEffectsSchema` (same entity group as vignette / dirt) with enable flags and params for:

- **depthOfField** — enabled, high quality, focus speed (autofocus smooth), and any node uniforms not fully driven by lens
- **lensFlare** — enabled, high quality, intensity / threshold as needed by `LensflareNode`
- **anamorphicFlare** — enabled, high quality, intensity, spread, vertical vs horizontal
- **filmGrain** — enabled, intensity (and node params as required)

DoF is **off** (`enabled: false`) in Default so first-run stays sharp (#340). Drive DoF from lens: focus distance (or autofocused head), focal length, f-stop (entrance pupil ≈ focal length / f-stop) mapped to `DepthOfFieldNode` focus distance, focal length, and bokeh scale. Document the heuristic formula in code comments only where the map is hard to follow; record the curve in the implementation plan / evidence note. Confirm Warudo’s unitless “aperture” on the VM before parity wording.

Autofocus tracks the Focus Character **head** (shared with #168 / orbit). Without a focus target, autofocus is a no-op and the control stays off or disabled in the UI without extra helper copy.

### Inspector and presets

Lens section replaces the primary FOV slider with: focal length (mm), f-stop, focus distance, autofocus, sensor preset, **read-only FOV readout**, near/far, Reset lens → Default.

Named presets (undoable apply):

| Preset | Lens | Look |
| --- | --- | --- |
| **Default** | 50 mm, f/4, Full Frame | DoF off; bloom as today (intensity 0); flare, smear, grain off |
| **Portrait** | 85 mm, f/1.8 | Autofocus on; visible DoF / bokeh |
| **Wide** | 24 mm, f/2.8 | DoF off by default |
| **Cinematic** | 35 mm, f/2 | Mild film grain + vignette; ACES — **documented full look** (may set grading tone mapping / mild vignette) |
| **Concert** | longer lens, derived FOV **below 35°** | Effects like Default (performance-safe) |

New cameras and first-run (#340) use Default. Presets must not silently overwrite unrelated grading unless the preset is a documented full look (Cinematic only in this set).

Effect toggles live with existing camera effects / look UI so they compose with vignette, dirt, and grading — not a second competing panel.

### Post chain

Extend `post-chain.ts`. Order after scene (+ haze / beams):

1. DoF (`DepthOfFieldNode`; scene color + viewZ / depth from scene pass)
2. Bloom (existing `BloomNode`; keep premultiplied-alpha composite)
3. Lens flare (`LensflareNode` on bloom texture)
4. Anamorphic smear (custom TSL from bloom; H/V)
5. Lens dirt + color grade / tonemap (existing)
6. Film grain (`FilmNode`)
7. Stylized effects (existing)
8. Display transform + optional FXAA

Leave slots for later AO / CA and LUTs. Each new effect: enable + quality/budget. Preview cheapens DoF / flare / anamorphic. Production and Performance honor toggles. Measure WebGPU and WebGL 2.

### Show document, blueprints, MCP

- `LensSchema` / `setCameraLens` gain physical fields; `fovDegrees` remains for convert and readout.
- `CameraEffectsSchema` / `setCameraEffects` gain the new effect groups.
- Property registry, `scene_inspect`, `scene_patch`, and set-property expose: `focalLengthMm`, `fStop`, `focusDistance`, `autofocus`, `sensorPreset`, and the new effect fields, next to `fovDegrees`.
- Warudo import and FOV tweens keep working through convert.

### Quality and evidence

- Reuse #56 quality / budget; per-effect high-quality flag is enough.
- Evidence: inspector screenshots of Default and Portrait; a still with DoF/bokeh; a still with flare (note anamorphic if visible); short note on WebGPU vs WebGL 2 and OBS transparency.
- Do not claim Warudo DoF aperture parity until the VM check.

### Implementation shape

One pass on branch `feat/camera-lens-343`: contracts and migrate → renderer chain and camera apply → inspector presets → MCP / registry → evidence. Update `ARCHITECTURE.md` if data paths change. Update `docs/warudo-parity.md` only for verified behavior. Prefer unit tests for pure FOV↔focal and DoF mapping math; integration at real renderer/protocol boundaries as needed.

## Acceptance criteria

- [ ] Design draft reviewed (this file).
- [ ] Inspector edits focal length, f-stop, focus distance, autofocus, sensor preset; FOV is derived readout; perspective apply uses `setFocalLength` / `filmGauge` (or tested equivalent).
- [ ] Presets Default, Portrait, Wide, Cinematic (and Concert); new/first-run use Default; apply undoable.
- [ ] DoF uses TSL `DepthOfFieldNode`, driven by lens / autofocus, can turn off.
- [ ] Lens flare uses TSL `LensflareNode` on bloom; anamorphic smear present; both can turn off.
- [ ] Film grain uses TSL `FilmNode`, can turn off.
- [ ] Existing bloom, grading, vignette, dirt, OBS transparency still work.
- [ ] No EffectComposer / UnrealBloomPass / BokehShader2 / FilmShader.
- [ ] Toggles + Preview cheapen path; Default usable at 1080p60 on WebGPU and WebGL 2.
- [ ] Fields on show document, blueprints, and MCP; `fovDegrees` writes convert.
- [ ] Evidence artifacts as above.

## Known gaps

- Exact Concert focal length (mm) for FOV &lt; 35° on Full Frame — tune during implement.
- Exact Default `focusDistance` (unused while DoF is off) and DoF bokeh-scale heuristic constants — tune during Portrait; VM check before parity text.
- Approach C is one pass / one PR; internal commits may still land in contract → renderer → UI order for review.
- Anamorphic smear parameter set — match Warudo ZH intensity / spread / vertical as far as a small TSL path allows; not bit-identical to removed `AnamorphicNode`.
