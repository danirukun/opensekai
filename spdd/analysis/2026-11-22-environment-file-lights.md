# Environment file lights analysis

Date: 2026-11-22. Scope: ENV-01 gap B — keep `KHR_lights_punctual` on environment import and add Allow Lights To Affect Characters. Contract: [environment file lights](../prompt/2026-11-22-environment-file-lights.md). Parent: [#39](https://github.com/danirukun/opensekai/issues/39). Changes: [environment import](../prompt/2026-10-13-environment-import.md) R11; [light entities](../prompt/2026-10-17-light-entities.md) R16.

## Sources

- [Warudo Environment](https://docs.warudo.app/docs/assets/environment): Allow Lights To Affect Characters (tip: leave off so the Directional Light asset, not lights inside the environment, lights the character).
- [Warudo Lights](https://docs.warudo.app/docs/assets/lights): per-light Affect Characters / Props / Environment (already shipped as scene light entities).
- Prior decision 10 in [light entities analysis](2026-10-17-light-entities.md): file lights stayed stripped so the environment toggle had nothing to control; a later slice imports them with a cap.

## Current state

- Environment entity: `assetId`, optional `reflectionsIntensity`. No lighting toggle.
- Importer `strip_lights` in `apps/desktop/src-tauri/src/assets/scene_import.rs` removes `KHR_lights_punctual` from the packed GLB.
- Scene lights are separate entities with their own affect flags and budgets (32 / 8 lit / 2 shadow).
- Renderer groups materials into characters / props / environment via `lightsNode` (`packages/renderer/src/scene-lights.ts`).
- Already-packed library GLBs have no file lights; a re-import is required.

## Decisions

1. **Keep punctual lights in the packed GLB.** Stop calling `strip_lights`. `GLTFLoader` creates the three.js lights under the environment root.
2. **File lights are not scene entities.** They do not appear in the Hierarchy Lights group, do not count toward the 32 / 8-lit / 2-shadow budget, and have no `setLight` path. The renderer attaches them from the loaded environment root.
3. **Always light the environment group.** File lights always join the environment `lightsNode`.
4. **Characters only when the flag is on.** Optional `allowLightsToAffectCharacters` (absent = false). When true, file lights also join the characters group. They never join props.
5. **Caps at import.** At most 8 punctual lights per packed environment; reject above. At most 2 of those may cast shadows; extra shadow flags stay off at load (or the importer clears shadow intent by documenting that only the first two keep shadows — renderer enforces at most 2 file-light shadows).
6. **One patch:** `setEnvironmentLighting { entityId, allowLightsToAffectCharacters }`.
7. **Old assets.** Existing library records stay dark of file lights until re-import.

## Risks

- Environments with many punctual lights fail import at the cap; the operator must simplify the source or wait for a later higher cap.
- File-light shadows add GPU cost on top of scene shadow lights; the two-shadow file cap limits that.
- Re-import is required for assets packed before this slice.

## Out of scope

Apply Environment Lighting, fog, ambient source, sky (ENV-02), lightmaps, props from file lights, Sketchfab, turning file lights into editable Hierarchy lights.
