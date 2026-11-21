# Physical Camera Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perspective cameras get a physical lens (focal length mm, f-stop, focus, sensor presets), named presets, and a TSL look stack (DoF, bloom-based lens flare, anamorphic smear, film grain) in one implementation pass for [#343](https://github.com/danirukun/opensekai/issues/343).

**Architecture:** Pure lens math in contracts (FOV ↔ focal, sensor sizes, DoF heuristic). Zod + Rust schemas store physical fields; `fovDegrees` stays readable and writable (writes convert). Renderer applies `filmGauge` / `setFocalLength` (or equivalent tested against that API). Post chain inserts DoF before bloom, then flare + anamorphic from the bloom buffer, then existing dirt/grade, then film grain, then stylized effects. Inspector replaces the FOV slider; presets apply undoable patches.

**Tech Stack:** three 0.187.0 (`three/webgpu`, TSL addons `DepthOfFieldNode`, `LensflareNode`, `FilmNode`), Zod, Rust `opensekai-contracts`, Svelte 5, `@oshi-connect/ui`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-camera-physical-lens-design.md`.

## Global Constraints

- Worktree: `/Users/danirukun/ghq/github.com/oshi-connect/opensekai/.worktrees/camera-lens-343` on `feat/camera-lens-343`. Verify `pwd` before Git. No `git -C`, no compound `cd`.
- `direnv exec . <command>` for cargo / Tauri / Rust compile. Shared target `$HOME/.cache/opensekai/target`.
- three stays **0.187.0**. No `EffectComposer`, `UnrealBloomPass`, `BokehShader2`, `FilmShader`. No removed `AnamorphicNode`.
- Default sensor: Full Frame **36×24 mm**. Default lens: **50 mm**, **f/4**, DoF **off**, flare/smear/grain **off**.
- `fovDegrees` writes convert through current sensor → `focalLengthMm`. Persist physical fields; keep `fovDegrees` in sync as derived storage for tweens/compat.
- Preview quality (`preview_v1`) **cheapens** DoF / flare / anamorphic; does not force them off.
- Premultiplied-alpha bloom composite must remain valid for transparent OBS.
- UI copy: short labels only (Focal Length, F-Stop, Focus Distance, Autofocus, Sensor, FOV, presets). No helper narration.
- Long prose (spdd, PR, parity) in ASD-STE100. No agent commit attribution.
- One feature branch / one PR (owner chose approach C); internal commits follow task order.
- Do not claim Warudo DoF aperture parity until a VM check; ship a documented heuristic.

## Review Focus

1. **DoF node parameter names:** three.js `dof(color, viewZ, focusDistance, focalLength, bokehScale)` — the node’s `focalLength` is a **world-unit** focus range, not mm. Map mm + f-stop into `bokehScale` (+ optional world focal-range heuristic). Never pass mm into that slot without conversion.
2. **OBS alpha:** bloom + flare + smear must not break premultiplied transparency.
3. **Default / first-run sharpness:** DoF off on Default and new cameras (#340).
4. **Legacy shows:** documents with only `{fovDegrees, near, far}` must normalize without framing drift beyond the Full Frame convert.
5. **WebGL 2:** chain with new effects off must still draw; with effects on, no hard crash.

## File map

| Area | Create | Modify |
| --- | --- | --- |
| Lens math | `packages/contracts/src/lens-math.ts`, `packages/contracts/test/lens-math.test.ts` | — |
| Lens schema | — | `packages/contracts/src/schema.ts` (`LensSchema`), `types.ts`, `index.ts`; Rust `crates/contracts/src/lib.rs` `Lens`; fixtures/vectors |
| Effects | — | `packages/contracts/src/camera-effects.ts`, `camera-effects.test.ts`; Rust camera effects; `packages/renderer/src/camera-effects-math.ts` |
| Registry / session | — | `property-registry.ts`, session property write / `scene-ops.ts` as needed |
| Renderer apply | `packages/renderer/src/lens.ts` (apply helpers) | `renderer.ts` (~482), screenshot camera create |
| Post stack | `packages/renderer/src/lens-look.ts` (DoF/flare/smear/film runtime) | `post-chain.ts`, `screenshot.ts`, grading only if bloom handle must be shared for flare |
| Autofocus | `packages/renderer/src/autofocus.ts` (or session-side smooth) | renderer frame update |
| Editor | presets helper | `CameraLensFields.svelte`, effects fields, `authoring.ts`, `live-fields.ts`, `property-defaults.ts`, `slider.ts`, Inspector wiring |
| Docs | spdd analysis + prompt | `ARCHITECTURE.md`, `docs/warudo-parity.md` (verified only) |

---

### Task 0: Slice contract

**Files:**
- Create: `spdd/analysis/2026-11-21-camera-physical-lens.md`, `spdd/prompt/2026-11-21-camera-physical-lens.md`

- [ ] **Step 1:** `pwd` → worktree path; `direnv allow`; confirm branch `feat/camera-lens-343`.
- [ ] **Step 2:** Write analysis from the design (problem, current chain, decisions table). Format like `spdd/analysis/2026-11-13-camera-effects.md`.
- [ ] **Step 3:** Write REASONS prompt. Map R1–Rn to Tasks 1–10. Safeguards = design anti-goals. Issue #343.
- [ ] **Step 4:** Commit: `Add the physical camera lens slice contract.`

### Task 1: Pure lens math

**Files:**
- Create: `packages/contracts/src/lens-math.ts`, `packages/contracts/test/lens-math.test.ts`
- Modify: `packages/contracts/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `export type SensorPresetId = 'fullFrame' | 'super35' | 'apsC' | 'mft'`
  - `export const SENSOR_PRESETS: Readonly<Record<SensorPresetId, { widthMm: number; heightMm: number; label: string }>>` with Full Frame `{36,24}`, Super 35 `{24.89,18.66}`, APS-C `{23.6,15.6}`, MFT `{17.3,13}` (document sources in one short comment if needed).
  - `verticalFovDegrees(focalLengthMm: number, sensorHeightMm: number): number` = `2 * atan((sensorHeightMm/2) / focalLengthMm) * (180/π)`.
  - `focalLengthMmFromVerticalFov(fovDegrees: number, sensorHeightMm: number): number` = inverse; clamp FOV to (1,179) before convert.
  - `filmGaugeMm(preset: SensorPresetId): number` = `SENSOR_PRESETS[preset].widthMm` (three.js `filmGauge` = width when aspect ≥ 1).
  - `bokehScale(focalLengthMm: number, fStop: number, quality: 'full' | 'cheap'): number` — heuristic: `clamp((focalLengthMm / fStop) * K, 0, MAX)` with `K_full = 0.02`, `K_cheap = 0.008`, `MAX_full = 8`, `MAX_cheap = 3` (tune in Task 6 if needed; keep constants exported).
  - `dofFocalRangeWorld(focusDistance: number, fStop: number, quality: 'full' | 'cheap'): number` — world-unit falloff for DoF node’s `focalLength` slot: start `max(0.05, focusDistance * (fStop / 32) * (quality === 'cheap' ? 1.5 : 1))`.
  - `concertFocalLengthMm(): number` → **85** (Full Frame vertical FOV ≈ 16° < 35°).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { SENSOR_PRESETS, verticalFovDegrees, focalLengthMmFromVerticalFov, bokehScale, filmGaugeMm, concertFocalLengthMm } from "../src/lens-math";

describe("lens-math", () => {
  it("Full Frame 50mm vertical FOV is about 27°", () => {
    expect(verticalFovDegrees(50, SENSOR_PRESETS.fullFrame.heightMm)).toBeCloseTo(27.0, 0);
  });
  it("round-trips FOV ↔ focal on Full Frame", () => {
    const fov = verticalFovDegrees(85, 24);
    expect(focalLengthMmFromVerticalFov(fov, 24)).toBeCloseTo(85, 5);
  });
  it("filmGauge for fullFrame is 36", () => {
    expect(filmGaugeMm("fullFrame")).toBe(36);
  });
  it("wider aperture raises bokehScale", () => {
    expect(bokehScale(85, 1.8, "full")).toBeGreaterThan(bokehScale(85, 8, "full"));
  });
  it("cheap quality lowers bokehScale", () => {
    expect(bokehScale(85, 1.8, "cheap")).toBeLessThan(bokehScale(85, 1.8, "full"));
  });
  it("Concert focal yields FOV under 35°", () => {
    expect(verticalFovDegrees(concertFocalLengthMm(), 24)).toBeLessThan(35);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run packages/contracts/test/lens-math.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `lens-math.ts` with the formulas above.
- [ ] **Step 4:** Run → PASS. Commit: `Add physical lens math for FOV and DoF heuristics.`

### Task 2: Lens schema, defaults, migrate

**Files:**
- Create: `packages/contracts/test/lens-schema.test.ts`, `crates/contracts/tests/lens_physical.rs` (or extend an existing lens test file if one exists)
- Modify: `packages/contracts/src/schema.ts` (`LensSchema`), helpers in `lens-math.ts` or new `lens.ts`; Rust `object!(Lens {…})` + `Validate`; `fixtures/protocol/validation-vectors.json` as needed; export from `index.ts`

**Interfaces:**
- Produces:
  - `CameraLens` fields: `focalLengthMm`, `fStop`, `focusDistance`, `autofocus`, `sensorPreset`, `fovDegrees`, `near`, `far`.
  - Ranges: `focalLengthMm` 12–300; `fStop` 1–32; `focusDistance` > 0 finite; `autofocus` boolean; `sensorPreset` enum; `fovDegrees` 1–179; `near`/`far` as today with `far > near`.
  - `DEFAULT_CAMERA_LENS`: 50 mm, f/4, `focusDistance` 3, `autofocus` false, `sensorPreset` `'fullFrame'`, `fovDegrees` from math, `near` 0.01, `far` 100.
  - `normalizeLens(input: unknown): CameraLens | null` — accepts legacy `{fovDegrees,near,far}` and fills physical via Full Frame convert; accepts full object; always recomputes `fovDegrees` from physical before return when physical present.
  - `lensWithFocalLength(lens, mm)`, `lensWithFovDegrees(lens, fov)` — return new lens with synced FOV/focal.
  - Zod: prefer `z.preprocess` / refine so `LensSchema.parse(legacy)` succeeds and yields full shape. `setCameraLens` uses the same schema.

- [ ] **Step 1: Failing tests** — legacy three-field lens parses to Full Frame physical; DEFAULT parses; invalid fStop fails; `lensWithFovDegrees` changes focal; `lensWithFocalLength` changes fov; far ≤ near fails.
- [ ] **Step 2:** Run → FAIL / schema mismatch.
- [ ] **Step 3:** Implement schema + normalize. Update `authoring.ts` later in Task 8; for now contracts tests may construct full lenses. Add a test helper `testLens(partial?)` in the test file.
- [ ] **Step 4: Rust** — mirror fields and validation; vectors for legacy migrate if the protocol layer validates lens shape on entity parse.
- [ ] **Step 5:** `pnpm vitest run packages/contracts` and `direnv exec . cargo test -p opensekai-contracts` — fix only failures caused by Lens shape (use `normalizeLens` / full defaults in fixtures that break). Prefer updating shared smoke camera fixtures once.
- [ ] **Step 6:** Commit: `Extend LensSchema with physical camera fields.`

### Task 3: Look-stack effect groups

**Files:**
- Modify: `packages/contracts/src/camera-effects.ts`, `packages/contracts/test/camera-effects.test.ts`, Rust camera effects, `DEFAULT_CAMERA_EFFECTS`, `packages/renderer/src/camera-effects-math.ts` (`EFFECT_ORDER` / `activeEffects` / `effectsKey` — only if these groups participate in the stylized key; **prefer a separate look-key** in Task 6 so dirt order stays B37-compatible)
- Create: `packages/contracts/src/lens-look.ts` (schemas for depthOfField, lensFlare, anamorphicFlare, filmGrain) **or** nest under `CameraEffectsSchema` as in the design

**Interfaces (nest under `CameraEffects` as design):**
- `depthOfField: { enabled: boolean; highQuality: boolean; focusSpeed: number /* 0–1 */ }` default `{enabled:false, highQuality:true, focusSpeed:0.35}`
- `lensFlare: { enabled: boolean; highQuality: boolean; threshold: number /* 0–1 */; intensity: number /* 0–4 */ }` default off, threshold 0.5, intensity 1
- `anamorphicFlare: { enabled: boolean; highQuality: boolean; intensity: number; spread: number; vertical: boolean }` default off, intensity 0.5, spread 0.5, vertical false
- `filmGrain: { enabled: boolean; intensity: number /* 0–1 */ }` default `{enabled:false, intensity:0.15}`
- Update `DEFAULT_CAMERA_EFFECTS` frozen object; tests for accept/reject; Rust mirror.

- [ ] **Step 1: Failing tests** for new groups (optional presence, defaults, range rejects).
- [ ] **Step 2:** Implement schemas + defaults + Rust.
- [ ] **Step 3:** Run contracts + cargo tests → PASS.
- [ ] **Step 4:** Commit: `Add DoF, flare, anamorphic, and film grain effect groups.`

### Task 4: Property registry and FOV convert writes

**Files:**
- Modify: `packages/contracts/src/property-registry.ts`, session property apply path (wherever `setProperty` writes `fovDegrees`), tests under `packages/session/test/` and contracts property tests
- Add keys: `focalLengthMm`, `fStop`, `focusDistance`, `autofocus`, `sensorPreset` (and effect properties if the registry already flattens effect fields — follow existing grading/effects pattern; if effects only use `setCameraEffects`, do not flatten unless already done for blur)

**Interfaces:**
- `readProperty` / `writeProperty`: writing `fovDegrees` calls `lensWithFovDegrees`; writing `focalLengthMm` calls `lensWithFocalLength`; writing `sensorPreset` recomputes `fovDegrees` from current focal; writing `autofocus` boolean; etc.
- Reading `fovDegrees` returns derived/stored synced value.

- [ ] **Step 1: Failing tests** — set `fovDegrees` 40 on Full Frame updates `focalLengthMm` to ≈ `focalLengthMmFromVerticalFov(40, 24)`; set `focalLengthMm` 85 updates `fovDegrees`; invalid ranges fail.
- [ ] **Step 2:** Implement registry + session write path.
- [ ] **Step 3:** Run session + contracts property tests → PASS (existing FOV tween tests should still pass because `fovDegrees` remains writable).
- [ ] **Step 4:** Commit: `Convert fovDegrees property writes through the physical lens.`

### Task 5: Apply physical lens on the Three camera

**Files:**
- Create: `packages/renderer/src/lens.ts`, `packages/renderer/test/lens.test.ts`
- Modify: `packages/renderer/src/renderer.ts` (replace `camera.fov = cameraEntity.lens.fovDegrees` ~482), screenshot `PerspectiveCamera` construction ~543

**Interfaces:**
- `applyPerspectiveLens(camera: PerspectiveCamera, lens: CameraLens): void` — set `camera.filmGauge = filmGaugeMm(lens.sensorPreset)`, `camera.setFocalLength(lens.focalLengthMm)`, `camera.near` / `far`, then `updateProjectionMatrix()`. Assert in test that resulting `camera.fov` is within ~0.1° of `lens.fovDegrees` (after sync) at aspect 16/9.
- If `setFocalLength` + `filmGauge` disagrees with our vertical FOV math at 16:9, **document the delta** and either (a) set `camera.fov = lens.fovDegrees` after setting filmGauge for framing parity with stored FOV, while still setting filmGauge for DoF consumers, or (b) adjust stored FOV to three’s result on apply — prefer **(a)** so inspector readout matches stored derived FOV; add a unit test that records the chosen behavior.

- [ ] **Step 1: Failing test** for `applyPerspectiveLens` round-trip at aspect 16/9.
- [ ] **Step 2:** Implement + wire renderer/screenshot.
- [ ] **Step 3:** Run renderer lens tests → PASS.
- [ ] **Step 4:** Commit: `Apply perspective cameras through focal length and film gauge.`

### Task 6: Post chain — DoF, flare, anamorphic, film

**Files:**
- Create: `packages/renderer/src/lens-look.ts`, `packages/renderer/test/lens-look.test.ts` (CPU / node construction tests; no GPU if project pattern avoids it)
- Modify: `packages/renderer/src/post-chain.ts`, `packages/renderer/src/screenshot.ts`, possibly `renderer.ts` to pass look + quality

**Interfaces:**
- `lookChainKey(effects, quality: 'full'|'cheap'): string` — rebuild when enables / highQuality / cheap mode change; numbers stay uniforms.
- `needsLook(effects): boolean` — any of DoF/flare/anamorphic/film active.
- `createLensLook(): { update(...); applyDoF(color, viewZ); takeBloom(bloomTex); applyFlareAndSmear(color, bloom); applyFilm(color); dispose() }`
- Chain order after haze/beams:
  1. If DoF enabled: `dof(color, scenePass.getViewZNode(), focusU, focalRangeU, bokehU)` (import from `three/addons/tsl/display/DepthOfFieldNode.js`). Focus from lens (autofocus updates uniform in Task 7).
  2. Existing bloom → keep bloom texture/node reference for flare.
  3. If lensFlare: `lensflare(bloomNode, { threshold, … })` composite onto color (additive / max as three’s node expects — follow addon usage; keep premultiplied validity; if flare is bloom-only ghosts, composite like bloomComposite or node’s output).
  4. If anamorphic: custom TSL — sample bloom, stretch UV on X (or Y if `vertical`), threshold, add to color with intensity/spread uniforms. Cheap: lower resolution / fewer taps.
  5. Dirt + grade (existing).
  6. If filmGrain: `film(color, intensityU)`.
  7. Stylized effects (existing).
- Preview (`preview_v1`): `quality = 'cheap'` for bokehScale, dof range, flare downsample, anamorphic taps.
- Extend `needsChain` / `chainKey` to include look key so enabling DoF rebuilds the chain.

- [ ] **Step 1: Failing tests** — `lookChainKey` / `needsLook`; anamorphic UV stretch pure function if extracted; ensure Default effects → `needsLook` false.
- [ ] **Step 2:** Implement runtime + wire `post-chain.ts` carefully (smallest change; dispose owned nodes).
- [ ] **Step 3:** Run renderer unit tests for look + existing post-chain/grading/effects tests → PASS.
- [ ] **Step 4:** Commit: `Insert TSL DoF, lens flare, anamorphic smear, and film grain into the post chain.`

### Task 7: Autofocus on Focus Character head

**Files:**
- Create: `packages/renderer/src/autofocus.ts`, `packages/renderer/test/autofocus.test.ts`
- Modify: `renderer.ts` (or session evaluation if focus distance must be authoritative in simulation — **prefer simulation/session** if focus distance is a scene property others read; if only visual, renderer uniform smooth is OK). Spec: focus distance is stored; autofocus updates it smoothly.

**Interfaces:**
- Resolve Focus Character from camera navigation `orbitCharacter.targetId` (same as #168). Head world position: VRM humanoid head bone if present, else avatar root + `(0, 1.5, 0)` fallback.
- `smoothFocusDistance(current, target, focusSpeed, dtSeconds): number` — `focusSpeed` 0–1 maps to lerp rate; e.g. `1 - (1 - focusSpeed)^ (dt*60)`.
- When `autofocus` true and target exists, each frame write smoothed distance into lens via live patch or local override that feeds DoF + inspector (match how other live camera fields work). When no target, leave distance unchanged.

- [ ] **Step 1: Failing tests** for smoothFocusDistance and head fallback offset.
- [ ] **Step 2:** Implement + wire.
- [ ] **Step 3:** Run → PASS. Commit: `Autofocus camera focus distance on the Focus Character head.`

### Task 8: Inspector, presets, authoring defaults

**Files:**
- Create: `apps/desktop/src/editor/lens-presets.ts`, `apps/desktop/src/editor/lens-presets.test.ts`
- Modify: `CameraLensFields.svelte`, camera effects UI component(s), `authoring.ts` (new camera → `DEFAULT_CAMERA_LENS`), `live-fields.ts` `parseLens`, `property-defaults.ts`, `slider.ts` (`SLIDERS` for focal/fStop/focus), Inspector reset marks, first-run show if it hardcodes FOV 40

**Interfaces:**
- Presets: `DEFAULT`, `PORTRAIT` (85, 1.8, autofocus true, DoF on), `WIDE` (24, 2.8), `CINEMATIC` (35, 2, filmGrain on mild, vignette mild, grading ACES — documented full look), `CONCERT` (85 mm, f/4, effects off).
- `applyLensPreset(name): { lens: CameraLens; effects?: CameraEffects; grading?: CameraGrading | null }` — Cinematic returns grading+effects; others only lens (+ DoF flags in effects for Portrait).
- UI: focal length / f-stop / focus distance sliders; autofocus control; sensor select; FOV read-only text; Reset lens; preset control (Select or button group — use `@oshi-connect/ui` if it has Select; else existing pattern). Undo via existing commit/revision path.
- Autofocus control: no extra helper text when disabled for lack of target (constitution).

- [ ] **Step 1: Failing tests** for preset payloads (Portrait DoF on, Default DoF off, Concert FOV < 35, Cinematic ACES).
- [ ] **Step 2:** Implement presets + UI. Run Svelte autofixer MCP on changed `.svelte` files.
- [ ] **Step 3:** `pnpm vitest run` on desktop editor tests + contracts. Browser check Lens section (constitution #15) when desktop is runnable.
- [ ] **Step 4:** Commit: `Add physical Lens inspector controls and named presets.`

### Task 9: Import paths and fixture cameras

**Files:**
- Modify: `scripts/warudo-show.ts` (FOV → `normalizeLens`), any MCP tool descriptions that list only FOV, smoke/fixture shows that need Default physical lens, blueprint templates that embed lens only if schema requires full lens on disk

- [ ] **Step 1:** Grep for `fovDegrees:` lens literals; update creators to `normalizeLens` / `DEFAULT_CAMERA_LENS` / `lensWithFovDegrees`.
- [ ] **Step 2:** Run `pnpm test:unit` → PASS (or document remaining intentional legacy parse-only paths).
- [ ] **Step 3:** Commit: `Normalize Warudo import and fixtures to the physical lens model.`

### Task 10: Docs, parity, evidence checklist

**Files:**
- Modify: `ARCHITECTURE.md` (lens fields + post order), `docs/warudo-parity.md` (only verified claims), issue acceptance note in spdd evidence section

- [ ] **Step 1:** Update architecture map for physical lens + look stack order.
- [ ] **Step 2:** Parity checklist: mark DoF/flare/film as partial until OBS evidence; no false “complete”.
- [ ] **Step 3:** Evidence checklist for the PR: screenshots Default/Portrait; DoF still; flare still; WebGPU vs WebGL 2 + OBS alpha note. Capture during QA, not invented.
- [ ] **Step 4:** `direnv exec . cargo sweep --time 7` when feature work finishes.
- [ ] **Step 5:** Commit: `Document physical lens data path and verification status.`

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Physical lens fields + Full Frame default | 1, 2, 8 |
| FOV derived + writable convert | 1, 2, 4 |
| Presets Default/Portrait/Wide/Cinematic/Concert | 8 |
| DoF via DepthOfFieldNode, off in Default | 3, 6, 8 |
| LensflareNode + anamorphic smear | 3, 6 |
| FilmNode | 3, 6 |
| Keep bloom/grade/vignette/dirt/OBS | 6 |
| No EffectComposer / banned passes | Global + 6 |
| Preview cheapen | 6 |
| Blueprints/MCP/registry | 4, 9 |
| Autofocus head | 7 |
| Evidence | 10 |
| One-pass delivery | All tasks one branch |

No TBD placeholders. DoF node world-unit `focalLength` vs mm is explicit in Review Focus and Task 6.
