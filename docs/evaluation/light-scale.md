# Light scale check (B43 PR2 to PR4)

Contract: [light scale](../../spdd/prompt/2026-11-21-light-scale.md), Part B. Analysis: [light scale](../../spdd/analysis/2026-11-21-light-scale.md). Issue: #316. The orchestrator runs the local checks and fills the rows. A row stays "not checked" until then.

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
