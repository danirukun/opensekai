# REASONS: Stage lights

Date: 2026-10-18. Scope: bundle B13 (#45 ENV-07 rest, #46 ENV-08 first subset, #40 ENV-02 ambient part). Analysis: [stage lights](../analysis/2026-10-18-stage-lights.md). Depends on: [live light editing](2026-10-18-live-light-editing.md) (B12). Changes: [light entities](2026-10-17-light-entities.md) R1, R2, R5, R6, R10, R12, R13, R14, R15, R17; [environment import](2026-10-13-environment-import.md) R17.

This file is the contract only. The implementation starts after the owner approves it. Spot cookies (gobos) are bundle B14.

## R — Requirements

### Light types (changes light entities R1, R2, R5)

R1. `LightSettings.type` is `'directional' | 'point' | 'spot' | 'ambient'`. `LightSettings` gets two optional fields:
- `cone: { angleDegrees: 1..170, penumbra: 0..1 }`. It is required when the type is `spot`, and ignored for other types.
- `volumetric: boolean` (a missing field means false). `true` is valid only for `point` and `spot`.

An `ambient` light must have `shadow.enabled: false`. TypeScript (zod) and Rust accept and reject the same shapes, with shared vectors. A B9 or B12 show loads without change.
R2. The limits stay: at most 8 light entities and at most 2 lights with `shadow.enabled: true`, of any type. A haze does not count as a light.
R3. A spot light shines along its local −Z axis from its position. The renderer uses a three.js `SpotLight` with `angle = angleDegrees / 2` in radians, `penumbra`, `distance = range`, and `decay = 2`. Its `target` is at the position + the direction, and it updates on each frame. A spot shadow uses a 1024 px map, near 0.1 m, far = range (or 50 m when the range is 0), and `shadow.focus = 1`. The bias, normal bias, intensity, and soft values map as for other lights.
R4. An ambient light is a three.js `AmbientLight` with the entity color and intensity, in the node sets of the groups whose affect flag is on. When a scene has at least one ambient entity, the node sets contain the ambient entities and not the fixed ambient light. When a scene has light entities and no ambient entity, the fixed ambient light (white, intensity 1) stays, as in B9. When a scene has no light entity, the built-in rule of light entities R5 stays. A hidden ambient light has intensity 0 and stays in its sets (R7 of light entities).
R4a. The room map of an environment (environment import R17) gives two parts: a diffuse fill that has no shadows, and reflections. When a scene has at least one ambient entity:
- The environment materials do not get the diffuse fill. The ambient entities give the fill of the environment, as they do for characters and props.
- The reflections are multiplied by the ambient light on the environment: the sum of the linear color × intensity of the visible ambient entities with Affect Environment on. Reflections Intensity (light entities R15) still multiplies them.

The fixed ambient light is white at intensity 1, so a scene without an ambient entity keeps the room map as before. Both values are uniforms, so a change does not build the environment pipelines again. Added after the owner found no shadows on an imported stage floor (2026-10-18).
R5. The node-set signature (light entities R7) adds `volumetric`. A change of `cone`, of color, of intensity, of range, or of the transform does not rebuild the node sets.

### Haze (ENV-08)

R6. A new entity kind `haze` has the base fields and a required group `haze: { density: 0..2, smoke: 0..3, intensity: 0..4, drift: 0..2 }`. Its transform is the box: the center, the rotation, and the size in meters as the scale. A scene has at most 1 haze entity; the budget rule rejects a second one. The patch op `{ kind: 'setHaze', entityId, haze }` replaces the group, with the same errors as `setLight`. Rust mirrors the kind, the group, the limit, and the op. MCP `scene_patch` names `setHaze` and the new light types in its description.
R7. The renderer draws a visible haze as a unit box mesh with the entity transform and a `VolumeNodeMaterial`, on a dedicated haze layer, which the main scene pass does not draw. The material has:
- 12 steps;
- `offsetNode = bayer16(screenCoordinate)`;
- a `scatteringNode` that samples one 128³ Perlin `Data3DTexture` (made once for each renderer) three times, as in the three.js r180 example, and scales by `density`, with `smoke` as the noise amount and `drift` as the speed of the noise in meters per second;
- `lightsNode` = the lights with `volumetric: true` (the haze node set, with no ambient light);
- `depthNode` = the scene pass depth;
- `receiveShadow` on.

A change of the haze values updates uniforms only and does not recompile.
R7a. (Added after the macOS probe, 2026-10-18.) three.js r180 needs three changes for the haze to scatter, each found with a minimal r180 probe:
- Point and spot lights also enable the haze layer, so the haze pass sees them.
- Each shadow camera keeps layer 0 and the haze layer, so a shadow map that the haze pass draws keeps its casters.
- The haze material uses a subclass of the internal `VolumetricLightingModel` that skips the shadow factor for a light without a shadow (r180 multiplies by a missing shadow node, and such a light scatters nothing).

The depth node is one texture node with its UV, because `sample()` makes a clone that a later texture change misses.
R8. When a visible haze exists, the renderer draws through one post chain:
- the scene pass, with its depth;
- the haze pass of the haze layer at 0.25 of the output resolution, blurred by `gaussianBlur` with strength 0.6;
- the composite `rgb = scene.rgb + haze.rgb × intensity` and `alpha = scene.alpha + (1 − scene.alpha) × min(1, max(r, g, b))` of the scaled haze color;
- then the output transform, and FXAA when the output camera asks for it.

When no visible haze exists, the chain is the B12 chain (direct draw, or FXAA). The chain is built again only when the haze presence or the anti-aliasing mode changes. A camera with `renderEnvironment: false` still draws the haze.
R9. If the haze pipeline fails to compile on WebGPU, the renderer stops drawing the haze until the next node-set rebuild. The frame acknowledgment then carries the existing `UNSUPPORTED Pipeline compile failed` warning. The scene, the lights, and the shadows still draw.
R10. The screenshot path (`screenshot.ts`) draws through the same chain, so a screenshot shows the haze.

### Editor (changes light entities R10, R12, R13, R14)

R11. The Add menu adds **Spot Light**, **Ambient Light**, and **Haze**:
- Spot Light: position (0, 3, 2), aimed at (0, 1, 0), intensity 60, range 15, cone 40° with penumbra 0.3, `volumetric: true`, shadow off.
- Ambient Light: white, intensity 0.3, all affect flags on.
- Haze: position (0, 4, 0), scale (20, 8, 20), density 1, smoke 1, intensity 2.5, drift 0.2. (Owner choice after the macOS check: at intensity 1 a beam over a dark background was faint.)

The light items are disabled at 8 lights. Haze is disabled when a haze exists. The Hierarchy shows the haze in the Lights group.
R12. The light Inspector:
- Type adds Spot and Ambient. A type change keeps the color, the affect flags, and the shadow (off for ambient), and takes the default intensity, range, and cone of the new type.
- Spot shows Range, **Angle** (slider 1–170°), **Penumbra** (slider 0–1), and **Volumetric**.
- Point shows **Volumetric**.
- Ambient hides Range, Shadow, and Set Direction From Main Camera.
- **Set Direction From Main Camera** shows for spot lights too.

Sliders and the color field work as in B12. The haze Inspector shows Density, Smoke, Intensity, and Drift as live sliders, plus Visible and Transform.
R13. The editor viewport draws a spot helper: the disc, plus four lines from the light to a circle in the light color at the range (5 m when the range is 0), at the cone angle. It draws a haze helper: a wire box of the volume and a small center disc. The disc and the edges are pick targets; the box faces are not. A point light helper does not change, and an ambient light has a disc only.

### Blueprints

R14. The property registry adds `haze` to the kinds of `position`, `rotation`, `scale`, and `visible`, and adds `{ key: 'hazeDensity', label: 'Haze Density', kinds: ['haze'], type: 'number', rule: { kind: 'range', min: 0, max: 2 } }`. `overrides.ts` commits an idle `hazeDensity` override with one `setHaze`. `intensity` works for all four light types.

### Documents

R15. `ARCHITECTURE.md` (output path) describes the light types, the ambient rule, the haze pass, and the composite. `docs/warudo-parity.md` records only the verified subset of ENV-07, ENV-08, and ENV-02.

## E — Entities

- `LightSettings.type: 'directional' | 'point' | 'spot' | 'ambient'`; `cone?: { angleDegrees: number; penumbra: number }`; `volumetric?: boolean`.
- `HazeSettings = { density: number; smoke: number; intensity: number; drift: number }`.
- `SceneEntity` (haze): `{ id, name, visible, transform, kind: 'haze', haze: HazeSettings }`. Rust: `SceneEntity::Haze { haze: HazeSettings }`.
- `PatchOp`: `setHaze { kind, entityId, haze }`. Rust: `PatchOp::SetHaze`.
- `PropertyKey` adds `hazeDensity`.
- `AddKind` adds `spotLight`, `ambientLight`, `haze`.
- Renderer: `LightGroup` adds `haze` (the volumetric lights); `createHaze(scene)`; `createPostChain(renderer)` replaces `createAntiAliasing`.

## A — Approach

Contracts first in TypeScript and Rust with shared vectors. Then the session ops and the registry. Then a renderer probe in the running app on macOS (WebGPU in WKWebView): one spot light with a shadow and one haze around the fixture avatar, checked in the preview and in OBS. If the haze pipeline does not compile in WebKit, stop and ask the owner. Then the renderer (spot, ambient, haze, chain), the editor, and the documents.

## S — Structure

- `packages/contracts/src/schema.ts`, `types.ts`, `property-registry.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`; contract and Rust tests.
- `packages/session/src/scene-ops.ts`, `overrides.ts`; session tests.
- `packages/renderer/src/scene-lights.ts`, `haze.ts` (new), `post-chain.ts` (replaces `anti-aliasing.ts`), `renderer.ts`, `screenshot.ts`, `editor-viewport.ts`; renderer tests.
- `apps/desktop/src/editor/lights.ts`, `authoring.ts`, `live-fields.ts`, `model.ts`, `slider.ts`; `components/LightFields.svelte`, `HazeFields.svelte` (new), `Inspector.svelte`, `Hierarchy.svelte`; desktop tests.
- `apps/mcp/src/server.ts`; MCP test.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/stage-lights.md` (new).

## O — Operations

1. Contracts and vectors: a spot light, a spot light without `cone` (reject), an ambient light with a shadow (reject), `volumetric: true` on a directional light (reject), a haze, two hazes (reject), `setHaze`, and a B9 scene unchanged.
2. Session: `setHaze`, its errors, and the `hazeDensity` override.
3. Probe (macOS, running app, MCP): a spot light with a shadow and a haze; the beam shows in the preview and in OBS; the WebKit pipeline compiles. Record the frame acknowledgments.
4. Renderer: spot (R3), ambient (R4), signature (R5), haze (R7), chain (R8), failure (R9), screenshot (R10), helpers (R13). Unit tests for the pure parts: the cone mapping, the ambient rule, the groups, the signature, and the rule for when the chain is built again.
5. Editor: R11, R12; model tests for the factories, the type change, and the disabled items.
6. macOS check with MCP, real input, and OBS:
   - beams and shadow shafts with a dark ambient;
   - OBS alpha over dark, light, and checker backgrounds;
   - a live drag of a spot light;
   - live haze sliders;
   - the frame time with 2 shadow spot lights and haze at `production_v1`, with app and OBS timing kept separate;
   - continued motion with the editor minimized;
   - the WebGL 2 result.
7. Documents (R15) and `docs/evaluation/stage-lights.md`.

## N — Norms

- Unit tests for the schemas, the Rust mirror, the session ops, and the pure renderer functions. The look, the cost, and OBS are checked in the running build on macOS (owner rule: no scratch harness page).
- Functional TypeScript and plain data. Controls come from `@oshi-connect/ui`, with the B12 slider and color fields.
- UI copy is the control label only.

## S — Safeguards

- Do not change the show file version or the quality profiles.
- Do not change how a B9 or B12 scene looks: the fixed ambient stays when there is no ambient entity.
- Do not read images back in the OBS output path. The haze pass stays on the GPU.
- Do not draw a helper in OBS or in a screenshot.
- Do not claim a frame time, a WebGL 2 result, or a light-background look before it is measured.
