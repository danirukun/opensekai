# Camera sky analysis

Date: 2026-11-22. Scope: ENV-02 First sky subset (#148 / #40). Contract: [camera sky](../prompt/2026-11-22-camera-sky.md). Related: [environment import](2026-10-13-environment-import.md), [chat thin tools](2026-11-08-chat-thin-tools.md).

## Sources

- [Warudo Camera](https://docs.warudo.app/docs/assets/camera) and Environment pages (background / skybox behavior; transparent output when no sky).
- Design slice 2 in [environment import design](../../docs/superpowers/specs/2026-10-13-environment-import-design.md): solid color, equirectangular image, HDR with optional IBL; replaces the neutral room map.
- three.js 0.187: `HDRLoader` (not deprecated `RGBELoader`), `Scene.background` / `backgroundIntensity` / `backgroundBlurriness`, `PMREMGenerator.fromEquirectangular`, `ColorEnvironment`, `EquirectangularReflectionMapping`. Official examples also set `scene.environment`; OpenSekai must not, or MToon avatars change.

## Current state

- `scene.background = null`, clear alpha 0 (`renderer.ts`, `backend.ts`).
- Per-camera `renderEnvironment` hides the environment mesh only.
- Room map on environment/prop lit copies via `environment-light.ts`; `scene.environment` stays null.
- Image assets: PNG/JPEG/WebP/GIF via `import_image`. No HDR asset format.
- Assist `sky_set` waits on #148.

## Decisions

1. **Sky on the camera**, not the scene. Each output camera can differ (Warudo-style; multi-cam OBS).
2. **Kinds:** `none` (default, transparent), `color`, `image`, `hdr`.
3. **Per-draw apply/restore** of `scene.background` so a transparent camera or client does not inherit coverage.
4. **IBL** optional: PMREM onto environment/prop copies only; never `scene.environment`. Color IBL uses `ColorEnvironment`.
5. **LDR** reuses `image` assets. **HDR** new format + `HDRLoader` for `.hdr` only. Ultra HDR / EXR deferred.
6. **Intensity / blurriness** map to three.js Scene background controls.
7. **Assist** adds `sky_set` after ops land.

## Risks

- Opaque sky removes the OBS hole; transparent must stay the default and must restore after each draw.
- Post chain (haze, bloom) composites over a clear of 0 today; an opaque sky changes that look (accepted for sky modes).
- Per-camera IBL requires swapping material env maps when the output camera changes.

## Out of scope

Procedural sky, fog, Apply Environment Lighting, character IBL, Ultra HDR, EXR, package format (#354).
