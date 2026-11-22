# Light scale check (B43 PR2 to PR4)

Contract: [light scale](../../spdd/prompt/2026-11-21-light-scale.md), Part B. Analysis: [light scale](../../spdd/analysis/2026-11-21-light-scale.md). Issue: #316.

The headless checks did not start the app, a WebView, or OBS. The orchestrator runs the local checks and fills the rows. Until then, each local check is "not checked". No row claims a GPU, OBS, look, or cost result that was not measured.

## Batched lit lights (PR2)

Date: 2026-11-22. Commit: `9ef05de` on `claude/b43-batched-lights` (the code commit; this page is in the next commit). Spike build for LC B4 and LC B5: the local branch `claude/b43-lit-spike`, commit `1d0319e`, with `LIMITS.litLights` and `MAX_LIT_LIGHTS` at 32 (R21). It is not pushed.

### Design

- Each of the characters, props, and environment groups uses one three.js `DynamicLightsNode` as its `lightsNode` (`batchedLights` in `packages/renderer/src/scene-lights.ts`, R13). Point, spot, and ambient lights without a shadow, and the fixed ambient light, go into uniform arrays. The point and spot capacity is `LIMITS.litLights` (R14).
- Directional lights are `GroupDirectionalLight`, an empty subclass of `DirectionalLight`. three batches only the exact light classes, so directional lights, also the built-in light, stay on the per-light path (TB3 (b)). Lights with a shadow stay on the per-light path.
- Each node gets its point, spot, and ambient data nodes when it is made, from three throwaway lights (TB4 (a), R15).
- A material group keeps its node while its per-light members stay the same: the built-in flag and the ID, type, and shadow switch of each per-light member, in scene order. Another change calls `setLights` on the same node and does not change `generation()` (R16).
- The haze keeps the per-light `lights()` node (R17). `renderer.lighting` stays the three default (TB2 (a), R18). `renderer.ts` did not change.

### Headless checks

See the pull request. The unit tests show the node identity, the per-light and batched split, the capacity, and the MToon and lilToon lighting models with a batched light node. They cannot show that a batched material compiles on a GPU, that it looks the same, or what it costs.

### Local checks

| Check | Requirement | Result |
| --- | --- | --- |
| LC B1, look (gate G-B3) | R19, R20 | Not checked |
| LC B2, stall (gate G-B2) | R16, R18 | Not checked |
| LC B3, 30 changes at 8 lit lights | R14, R16 | Not checked |
| LC B4, cost at 8, 16, and 32 lit lights (spike build) | R21 | Not checked |
| LC B5, 30 changes at 32 lit lights and shader size (spike build) | R14, R21 | Not checked |
| LC B6, minimized and alpha | R19 | Not checked |

## Shadow map cache (PR3)

Date: 2026-11-22. Branch `claude/b43-shadow-cache`. Spike build for LC S2: the local branch `claude/b43-shadow-spike` (`LIMITS.shadowLights` and `MAX_SHADOW_LIGHTS` 4). It is not pushed and not merged (TB7).

### Design

- Each light with a shadow has `shadow.autoUpdate` false. In each applied frame the renderer finds the dirty shadow lights with `shadowDirty` (`packages/renderer/src/shadow-cache.ts`) and sets `shadow.needsUpdate` on them (`SceneLights.markShadows`). three draws a marked map one time, in the first render of the frame that uses it, so the haze pass and the beam pass use the map of the scene pass (R22).
- A light is dirty when it is new or its shadow turned on, when its type, position, rotation (also a gizmo draft), range, cone, or shadow settings change, after a light-set rebuild, and when the output camera `renderEnvironment` changes (R23).
- A light is also dirty when a caster changed that is in its shadow volume now or was in it at its last mark (R23, R24). A character is a sphere at its root. Its radius is the distance from the root to the farthest corner of its rest-pose box, times the largest root scale, plus 1 m. A character changes in each frame, so a light with a character in its volume draws its map in each frame (R25). A prop or the environment is its world bounding sphere. The renderer measures it again only when the root transform, the model, the visibility, or the saved material values change.
- Before a screenshot, each shadow light is dirty. A capture render marks each shadow light. The next applied frame after a screenshot or a capture marks each shadow light again (R26).
- Volumes (R24): a point light reaches `range` plus the sphere radius, or everything when `range` is 0. A spot light reaches its half cone angle plus `asin(radius / distance)`, and `range` (or 50 m when `range` is 0) plus the radius. A directional light holds its shadow box: ±10 m across the light, and 0.5 m to 100 m along the light from the light position, which is 50 m from the focus against the light direction.

The unit tests (`shadow-cache.test.ts`, 9 tests; one test in `scene-lights.test.ts`) show the volume tests and the dirty rule. They cannot show that a shadow looks correct, that no shadow is stale, or what the cache saves on a GPU.

### Local checks

| Check | Requirement | Result |
| --- | --- | --- |
| LC S0, main case (owner Q5): Catboy on a flat floor with one directional and one spot shadow light, Wide and Close cameras; OBS screenshots before and after PR3, and the cost | R25, R27 | Not checked |
| LC S1, correctness (gate G-B4): character shadow with motion, a dragged spot light, a moved prop, a shadow turned on, a screenshot and a capture against OBS, `renderEnvironment` off and on | R22 to R27 | Not checked |
| LC S2, cost (spike build): 2 and 4 spot shadow lights away from the character, 4 with 2 on the character, cache on and off, 1 point shadow against 1 spot shadow | R22 | Not checked |
| LC S3, 30 changes at 4 shadow lights: no `Pipeline compile failed` | R22 | Not checked |
| LC S4, alpha and minimized | R22 | Not checked |
