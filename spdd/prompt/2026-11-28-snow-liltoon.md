# REASONS: Snow on lilToon characters and outlines

Analysis: [Snow on lilToon characters and outlines analysis](../analysis/2026-11-28-snow-liltoon.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md). This contract is slice 3 of the design.

## R — Requirements

- R1. A lilToon avatar gets the build-up of the design: one state buffer and one compute step for each avatar, as an MToon avatar.
- R2. A `CharacterLilToonMaterial` surface with a share moves each vertex along its rest normal by `thickness × amount`, before the skinning.
- R3. A `CharacterLilToonMaterial` surface with a share mixes the base colour to `SNOW_COLOR` by the snow mask, before the lighting. The mask is the mask of the MToon material (`snowMaskNode`).
- R4. On the same surface, the shade colour of the bands mixes to `SNOW_SHADE` by the mask, and the backlight, matcap, and rim terms are multiplied by `1 − mask`. Emission does not change.
- R5. The outline copy of an MToon or a lilToon material gets the share and the push of R2. Its colour, its shade, and its effects do not change.
- R6. A material with blended transparency gets no share, as before.
- R7. The program key of a `CharacterLilToonMaterial` with a share has the id of its state buffer. A material without a share keeps the key of slice 2. The program key of an outline with a share has the id too.
- R8. The fork `danirukun/three-liltoon` (branch `webgpu`) gets two protected methods on `LilToonNodeMaterial`: `shadeColor(shade)`, which returns its input by default, and `effectStrength()`, which returns null by default. The lighting model applies them as R4 says. A material that does not override them gives the same graph as before.
- R9. `packages/renderer/package.json` pins the fork commit with R8. The lockfile changes with it.
- R10. A material of each kind that holds the share of another avatar gives the warning `Snow build-up shares a material`, as before.

## E — Entities

- `SnowShare` (renderer): no change.
- `CharacterLilToonMaterial` gets `snow: SnowShare | null`.
- `LilToonLightingHost` (fork) gets `shadeColor(shade)` and `effectStrength()`.

## A — Approach

In the fork, `LilToonNodeMaterial` adds the two methods and passes them through `#lightingHost()`. `tslShade` takes an optional shade transform and applies it after `_ShadowMainStrength`, before the light. `finish` mixes the colour before and after each of the backlight, the matcap, and the rim by the strength.

In OpenSekai, `snow-surface.ts` gets two rules: `snowPushEligible` (no blended transparency) and `snowColorEligible` (also not an outline). `CharacterMToonMaterial` uses the push rule for the push and the key, and the colour rule for the colour and the variants. `CharacterLilToonMaterial` gets the same fields and overrides `setupPosition`, `setupDiffuseColor`, `shadeColor`, `effectStrength`, `customProgramCacheKey`, and `copy`. The facade accepts each character material of the two kinds.

## S — Structure

- Fork: `src/webgpu/LilToonNodeMaterial.ts`, `src/webgpu/LilToonLightingModel.ts`, `test/webgpu/lighting.test.ts`, `dist/`.
- `packages/renderer/package.json`, `pnpm-lock.yaml`: the pin.
- `packages/renderer/src/snow-surface.ts`: the two rules.
- `packages/renderer/src/character-mtoon.ts`: the rules for the outline.
- `packages/renderer/src/character-liltoon.ts`: the snow nodes.
- `packages/renderer/src/snow.ts`: the guard for the two kinds.
- `packages/renderer/test/snow-surface.test.ts`, `snow-facade.test.ts`, `character-liltoon.test.ts`: the tests.

## O — Operations

1. Record the decisions of the analysis in the design.
2. Fork: write failing tests (the shade hook reaches the shade term; the strength reaches the backlight, matcap, and rim terms and not emission; a material without overrides keeps its graph), then the code, then `dist`. Commit in the fork. Ask the owner before the push.
3. OpenSekai: write failing tests: the two rules; the lilToon key with a share, two shares, and an outline; `copy` keeps the share; the lilToon graph has the push, the colour, the shade, and the strength for a surface, and the push only for an outline; the facade gives the share to a lilToon surface and to outlines of the two kinds, and not to a blended material.
4. Write the code. Change the pin after the push.
5. Check in the running app and OBS with the lilToon Catboy sample and the MToon Catboy: build-up and shelter on lilToon; the shade on the snow in a shadow; two lilToon performers keep separate snow; the outline follows the snow at the silhouette for the two kinds; no `Pipeline compile failed`, `Snow failed`, or `Snow build-up shares a material` warning. Record the sha256 of the fork `dist/webgpu.js` that the app loads.
6. Update the design status, the evidence page, and the parity checklist.

## N — Norms

Functional TypeScript and plain data. A unit test for each new function behavior. The fork keeps its own style (Prettier, tabs) and its own test helpers. Each fork hook has a general name; the fork does not know about snow.

## S — Safeguards

- No change to the build-up rule, the flakes, the sky pass, the session cover, or the constants.
- No contract, MCP, or saved-data change.
- A lilToon material without a share draws as before. The fork tests check that the default hooks keep the graph.
- No push of the fork or of the branch without the owner.
- The gate of slice 1 stays open. This slice makes no cost claim.
