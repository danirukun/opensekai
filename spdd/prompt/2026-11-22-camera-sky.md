# REASONS: Camera sky

Date: 2026-11-22. Scope: ENV-02 First sky subset (#148). Analysis: [camera sky](../analysis/2026-11-22-camera-sky.md). three.js 0.187 APIs: `HDRLoader`, `Scene.background*`, `PMREMGenerator.fromEquirectangular`, `ColorEnvironment`.

## R — Requirements

R1. A camera has an optional `sky` group. Missing or `kind: 'none'` means transparent clear (`scene.background = null`, clear alpha 0). Valid kinds: `none` | `color` | `image` | `hdr`.
R2. Shape (zod + Rust, shared vectors):
- `kind` required when `sky` is present.
- `color?: #rrggbb` required when kind is `color`.
- `assetId?: Id | null` required (non-null for a drawn sky) when kind is `image` or `hdr`.
- `intensity?: number` 0..2 (missing = 1) → `scene.backgroundIntensity`.
- `blurriness?: number` 0..1 (missing = 0) → `scene.backgroundBlurriness` (image/hdr only; ignored for color/none).
- `ibl?: boolean` (missing = false).
R3. Patch `{ kind: 'setCameraSky', entityId, sky }` replaces the group (or clears when `sky` is `{ kind: 'none' }` / the caller may send the full group). Fails `INVALID_INPUT` if not a camera, `NOT_FOUND` if unknown. MCP reaches it through `scene_patch`.
R4. LDR equirect: asset kind `image` (existing `import_image`). After decode, set `EquirectangularReflectionMapping`. HDR: new `AssetFormat` `hdr` (Radiance `.hdr`); host stages with magic-byte check; renderer loads with `HDRLoader` from `three/addons/loaders/HDRLoader.js`. Do not use `RGBELoader`. No `.exr` / Ultra HDR in this slice.
R5. Draw path in `submit` and `renderScreenshot` for the active output camera:
1. Apply background: `Color` for color; equirect texture for image/hdr; else null + clear alpha 0.
2. Set intensity and blurriness from the group.
3. If `ibl`: replace the room PMREM on environment/prop copies with PMREM from the equirect (`fromEquirectangular`) or from `ColorEnvironment(color)` for color. Else keep `RoomEnvironment`.
4. Never set `scene.environment`.
5. After the draw (or before the next unrelated draw), restore `scene.background = null` when the next camera needs transparency, or always restore at end of the submit so a later transparent path is safe.
R6. `renderEnvironment: false` still hides the environment mesh; sky is independent.
R7. Editor Camera **Rendering** section: Sky kind, color field, image/HDR pickers, Intensity, Blurriness (image/hdr), IBL. Labels only.
R8. After R1–R7 land, assist adds `sky_set` (kind, color, asset ref, ibl) to thin tools; `TOOL_CONTRACT_VERSION` stays 1 with an additive tool, or bump if the contract requires it — follow [chat thin tools](2026-11-08-chat-thin-tools.md) patterns.
R9. Evidence `docs/evaluation/camera-sky.md`; parity ENV-02 Partial with verified subset; `ARCHITECTURE.md` output path notes per-camera sky.

## E — Entities

- Camera: `sky?: CameraSky`.
- `CameraSky = { kind, color?, assetId?, intensity?, blurriness?, ibl? }`.
- `PatchOp::SetCameraSky`.
- Asset: format `hdr`, kind stays a dedicated image-like record or `image` with format hdr — prefer kind `image` with format `hdr` if the registry allows, else kind `hdr`. Pick the path that matches existing `AssetKind` / `AssetFormat` patterns with least churn (implementation: add `hdr` to `AssetFormat` and stage under `image_` or `hdr_` prefix consistently with registry rules).

## A — Approach

Contracts first. HDR host path. Session op. Renderer sky module + environment-light PMREM swap. Editor. Assist `sky_set`. Tests: schema, session, pure sky apply helpers, headless transparent vs color clear when feasible.

## S — Structure

- `packages/contracts`, `crates/contracts`, vectors.
- Host: HDR parse/stage beside image import.
- `packages/session`, `packages/renderer` (new `sky.ts` or inline in `renderer.ts` / `environment-light.ts`), `screenshot.ts`.
- Editor Inspector Rendering + import wiring.
- `packages/assist` intents + compile if R8.
- Docs: evaluation, parity, ARCHITECTURE.

## O — Operations

1. Contracts + Rust + vectors.
2. HDR import host path + tests.
3. Session `setCameraSky`.
4. Renderer: apply/restore background; HDRLoader; IBL PMREM swap; screenshot path.
5. Editor Rendering UI + import.
6. Assist `sky_set`.
7. Evaluation + parity + ARCHITECTURE.

## N — Norms

Unit tests for schema, session, pure helpers. Functional TypeScript. UI labels only. STE100 for docs.

## S — Safeguards

- Default sky remains transparent.
- Do not set `scene.environment`.
- Do not use `RGBELoader`.
- Do not claim OBS evidence without a recorded check.
- Do not change show `schemaVersion`.
