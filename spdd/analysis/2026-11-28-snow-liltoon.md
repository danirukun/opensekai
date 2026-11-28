# Analysis: Snow on lilToon characters and outlines

Date: 2026-11-28. Scope: slice 3 of the snow design. Contract: [Snow on lilToon characters and outlines](../prompt/2026-11-28-snow-liltoon.md). Design: [snow design](../../docs/superpowers/specs/2026-11-26-snow-design.md).

## Request

The owner selected slice 3: snow build-up on lilToon characters, and the vertex push on the outlines of MToon and lilToon materials. The gate of slice 1 is still open. This slice changes the materials and the facade only. It does not change the build-up rule, the flakes, the sky pass, or the session cover.

## Current state

Each fact was read in the code on 2026-11-28.

- `snowEligible` (`packages/renderer/src/snow-surface.ts`) refuses an outline copy and a material with blended transparency. A unit test keeps this rule (`snow-surface.test.ts`, "gives no snow to an outline copy or to a blended material").
- The facade (`packages/renderer/src/snow.ts`, `settle`) gives the share to a `CharacterMToonMaterial` only. An avatar with no MToon material that can take snow gets no buffers and no step. Thus a lilToon avatar has no snow.
- The `characters` list of an avatar binding (`packages/renderer/src/avatar-pose.ts:111`) has each MToon and lilToon material on the meshes, the outline copies too. The facade gets this list.
- `CharacterMToonMaterial` adds the push to `positionLocal` before `super.setupPosition`. The three-vrm 3.5.5 outline (`MToonNodeMaterial.setupPosition`) sets `positionNode` to `positionLocal` plus the outline offset, and `NodeMaterial.setupPosition` assigns it after the skinning. So an outline that has the push before the skinning puts its offset on top of the push.
- The lilToon outline of the fork (`tslOutlinePosition`) also takes `positionLocal` as its base. The same order applies.
- `CharacterLilToonMaterial` (`packages/renderer/src/character-liltoon.ts`) has no snow field. Its program key adds `character` only.
- The fork `danirukun/three-liltoon` (branch `webgpu`, pin `716557bd`) computes the lilToon lighting in `LilToonLightingModel.finish`. The albedo is `diffuseColor.rgb`, so a subclass that changes `diffuseColor` after `super.setupDiffuseColor` changes the base colour of the shading. The shade colour (`tslShade`) and the backlight, matcap, and rim terms are inside `finish`. A subclass cannot reach them. The fork has hooks of the same type for OpenSekai already: `receivedShadow`, `receivedShadowAfterBands`, and `roomIrradiance`.
- The fork shares one lilToon program between materials with the same features (fork `2082247`). Its property nodes are static. Two avatars with one program key thus read one state buffer, as the MToon materials did before the fix `ec55f90a`.
- The fork `copy` calls `setupNodes` before the subclass copies its fields. `setupNodes` runs in the constructor before the subclass field initializers, so it must not read a subclass field.

## Decisions

1. **Fork hooks (owner, 2026-11-28).** The fork gets two protected methods on `LilToonNodeMaterial`, with general names. `shadeColor(shade)` changes the shade colour of the bands before the light. `effectStrength()` gives a factor on the backlight, matcap, and rim terms (1 keeps them, 0 removes them, null keeps them). The other choice was no fork change: then the snow shade is the authored `_ShadowColor` on white, and the matcap and the rim draw on the snow. The fork commit needs a push to the `webgpu` branch and a pin change. The agent asks the owner before each push.
2. **lilToon surface.** The base colour mixes to `SNOW_COLOR` by the mask, after `super.setupDiffuseColor`. `shadeColor` mixes the shade to `SNOW_SHADE` by the mask. `effectStrength` is `1 − mask`. Emission does not change, as on MToon.
3. **Outlines.** The outline copy of each kind gets the share and the vertex push only. Its colour stays the outline colour. Without the push, the snow layer covers the outline of the surface below it, and the outline shows inside the snow at the silhouette.
4. **Two rules.** `snowEligible` splits in two: the push needs a material without blended transparency; the colour also needs a surface, not an outline.
5. **Program key.** The lilToon key gets `:snow` and the id of the state buffer, as the MToon key does. The outline key of each kind gets it too, because its vertex stage reads the buffer.
6. **Facade.** The facade gives the share to each character material of the two kinds, outlines too. `materialIds` then names the outline pipelines for the blame of a failed compile. An avatar that has only blended materials still gets no build-up.
7. **No `_UseShadow`.** A lilToon material without the shadow feature has no shade term. The snow on it gets the base colour only. The design records this.
8. **One displacement for each position (owner, 2026-11-28, after the OBS check).** The push of slices 1 to 3 moved each vertex along its own normal by its own amount. A mesh has more than one vertex at one position where its normals or UVs split. These copies moved apart, so a gap opened at the raglan seam of the tops. The glasses frame of the Catboy samples is flat shaded: 436 of its 444 positions split, each split is a hard edge (the smallest dot product of the copy normals is below 0.5), and its shortest edges are 2.4 mm. Its faces moved apart by up to the thickness (15 mm, or 50 mm at the maximum), and long shards showed across the face. At `thickness` 0 the shards do not show. The fix keeps the build-up and the colour, and changes only the push:
   - The pack groups the vertices of each geometry that the mesh draws by their exact position. Each copy of a group gets the same direction (the normalized sum of the copy normals), the same scale, and the same representative vertex (the copy whose normal points most up). The push of a vertex is `direction × scale × thickness × amount of the representative`. Thus each copy at one position moves by the same vector, and no gap opens.
   - The scale is `smoothstep(0.7, 0.9, d)`, where `d` is the smallest dot product of the copy normals of the group, and 1 for a vertex without a copy. A hard edge (as on the frame, and the opposite normals of a double-sided layer) gets no push. Measured on the two Catboy samples (2026-11-28): each of the 436 split positions of the glasses frame has `d` of 0.149 or less. The tops have 160 split positions: 71 have `d` of 0.9 or more (full push), 22 are from 0.7 to 0.9 (part of the push), and 67 are below 0.7 (no push). The positions below 0.7 include a pole on the top of each sleeve, at (±0.557, 1.350, −0.030) in the file, with 12 copies and `d` −0.47, and a line along the lower side of each sleeve with `d` from 0.48 to 0.90.
   - The colour mask keeps the amount of the vertex itself, so the top of the frame shows snow and its front does not.
   - Limit: a thin mesh with smooth normals (no split) still swells by the thickness. The two Catboy samples have none.
   - Limit (OBS, 2026-11-28): a position with no push or part of the push, next to positions with the full push, makes a dip in the layer. At `thickness` 0.015 the top edge of the sleeve snow shows a small dip and no gap. At 0.05 a narrow wedge with the outline colour shows across the upper sleeve, on the two kinds, at the same place as before R11. Not isolated: which positions make the wedge. A follow-up can make the scale change more gradually, for example a lower edge of the band. The frame stays at no push while the lower edge is above 0.149. The owner decides.

## Risks

- The outline pipelines of an avatar are built again when snow comes, as the surface pipelines are. The Catboy lilToon sample has outline materials. The first snow frame can take longer than in slice 1. This slice records the first frame, but makes no cost claim.
- The pin change takes a new fork `dist`. The lilToon evidence of MAT-02 is at the old pin. The hooks are no-ops for a material without snow, and the fork tests check that. The slice makes no new claim about the lilToon look without snow.
- The WebKit cache can serve an old dependency after a change of `node_modules` (memory note). The evidence records the sha256 of `dist/webgpu.js` that the app loads.
- `effectStrength` mixes before and after each effect. A matcap in multiply mode then goes to the colour without the matcap, not to white. This is the intent: the snow covers the effect.
