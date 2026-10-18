# Light entities analysis

Date: 2026-10-17. Scope: bundle B9 (#45 ENV-07 first subset, #39 ENV-01 lighting part). Contract: [light entities](../prompt/2026-10-17-light-entities.md).

## Sources

- [Warudo Lights](https://docs.warudo.app/docs/assets/lights), read 2026-10-17. It gives: three light types (Directional Light, Point Light, Volumetric Light); a new scene already has a directional light; other lights come from the Add Asset menu; the position of a directional light has no effect, only its rotation; each light has Color and Intensity; each light can turn its effect on characters, props, and the environment on or off; Shadow makes the light cast shadows; a character shadow shows on the environment only when the light has Affect Environment on; too many lights cause performance problems. It does not give default values, ranges, or a light limit.
- [Warudo Environment](https://docs.warudo.app/docs/assets/environment), read 2026-10-17. It gives: Allow Lights To Affect Characters (the tip recommends off, so that the Directional Light asset controls the character light); Override Environment Settings with Ambient Lighting Source (ignored with baked lighting) and Environment Reflections Intensity. Not every environment supports each override.
- UI audit 0.15.1 lines in [the parity checklist](../../docs/warudo-parity.md): lights affect characters, props, and environment separately; Set Direction From Main Camera aims a directional light; shadow controls are enabled, intensity, soft shadows, bias, and normal bias. The ENV-02 line lists the environment overrides (ambient source, skybox intensity, reflections, fog) and Apply Environment Lighting.
- Workshop study lines (ENV-07): sampled environments have 1 to 312 lights, and 4 of 7 have reflection probes.

## Current state

- **Scene lights (ENV-07).** The scene has no light entity. `renderer.ts` adds one `AmbientLight` (white, intensity 1) and one `DirectionalLight` (white, intensity 3, position `[2, 4, 3]`, target at the origin) to each renderer client. The user cannot change them. No mesh casts or receives a shadow, and the renderer does not turn on its shadow map.
- **Environment light (ENV-01).** The one `environment` entity gets a PMREM `RoomEnvironment` map on per-instance copies of its lit materials (`environment-light.ts`). `scene.environment` stays null. The fixed ambient and directional lights light all materials: characters (MToon), props (`mesh` entities), and the environment.
- **File lights.** The scene importer removes `KHR_lights_punctual` from each packed GLB (environment import contract, R11 and Safeguards), so an environment brings no lights.
- **Materials.** Avatar materials belong to each VRM instance. Prop and environment instances are clones of a cached asset scene. Only the environment gets per-instance material copies today; prop instances share the cached materials.
- **Blueprint targets.** The property registry (`packages/contracts/src/property-registry.ts`) has position, rotation, scale, and visible for placed kinds, and `fovDegrees` and `renderEnvironment` for cameras.
- **Renderer support.** The renderer uses `three/webgpu` 0.180.0. `NodeMaterial.lightsNode` sets the lights for one material. `LightShadow.intensity` exists. The shadow map filter type is one setting for each renderer.

## Decisions

These decisions are reversible. The owner can change each one in review of this contract before code exists.

1. **A light is a scene entity.** A new entity kind `light` has the base fields and one `light` group: `type` (`directional` or `point`), `color`, `intensity`, `range` (point only), the three affect flags, and a `shadow` group. One patch operation `setLight` replaces the group, as `setCameraLens` does for the lens. The transform places the light. Alternative: one operation for each property.
2. **Color is a `#rrggbb` string** in sRGB. The UI kit has no color picker, so the Inspector uses a kit `Input` with hex validation. Alternative: an sRGB `Vec3` from 0 to 1, with three number fields.
3. **Direction.** A light shines along its local −Z axis, as a camera looks along its local −Z axis. Thus Set Direction From Main Camera copies the output camera rotation into the light rotation with one `setTransform`. The position of a directional light has no effect on its light, as in Warudo.
4. **Built-in light compatibility.** When a scene has no `light` entity, the renderer adds the built-in directional light as today. A new scene from the editor gets one Directional Light entity with the same values. Thus an old show, each evaluation scene, and each existing test render without change. When the user removes the last light, the built-in light comes back; to make a dark scene, the user sets the intensity to 0 or hides the light. Alternative: Open adds a light entity to a show that has none, so the file changes on the next save.
5. **Ambient light stays fixed** (white, intensity 1, on all materials). The ambient source and the environment overrides belong to ENV-02 (#40, #148). Alternative: a scene ambient setting in this slice.
6. **Affect flags use `lightsNode`.** The renderer puts each material in one of three groups: characters (avatar entities), props (`mesh` entities), and environment (the `environment` entity). For each group it builds one `lights([...])` node from the lights that affect that group, plus the ambient light. Prop and environment instances get per-instance copies of each lit material (today the environment copies only standard materials). Alternative: three.js layers. Layers do not filter lights in the WebGPU renderer.
7. **Limits.** A scene holds at most 8 light entities, and at most 2 of them have `shadow.enabled: true`. The schema budget rule rejects more. The handbook gives no limit; the workshop study shows up to 312 lights, which a forward renderer cannot draw at 60 fps. Alternative: no limit, with a warning.
8. **Shadows.** Both light types can cast shadows. Avatar, prop, and environment meshes cast and receive shadows when at least one light has a shadow. The shadow map is 2048 px for a directional light and 1024 px for each face of a point light. The quality profiles do not change, because a profile is a frozen measurement setting. The directional shadow camera covers a box of 20 m × 20 m around the world origin, 0.5 m to 100 m along the light direction. Soft shadows set the PCF radius to 2 (owner decision on #202; radius 4 gave streaks), hard shadows to 1, with one renderer-wide PCF filter. Alternative: a new quality profile with a shadow size.
9. **A hidden light** stays in its `lightsNode` sets with intensity 0. Thus a visibility change (for example from a Blueprint) does not recompile materials. A hidden shadow light still renders its shadow map, and hidden lights count toward the limits. A change of type, affect flags, shadow on or off, or the light count rebuilds the node sets and recompiles materials.
10. **ENV-01 lighting part.** This slice adds two things to the environment: the per-light Affect Environment flag (with character shadows on the environment, as the handbook describes), and an optional environment `reflectionsIntensity` from 0 to 2 (default 1), which sets `envMapIntensity` on the environment material copies. File lights stay removed at import, so Allow Lights To Affect Characters has nothing to control; it comes with a later file-light import slice. Ambient Lighting Source stays in ENV-02. Alternative: import `KHR_lights_punctual` lights in this slice, with a light cap and a re-import of each environment.
11. **Editor helpers.** The editor viewport draws a small pickable helper for each light (a disc for a point light, a disc and an arrow for a directional light), so the user can select a light and drag it with the gizmo. The helpers exist only in the editor viewport. The OBS output does not draw them.
12. **Blueprint targets.** Lights get position, rotation, and visible, and a new `intensity` key (a number from 0 to 1000 for both types). Lights do not get scale, because scale has no effect on a light. Color and the shadow group are not Blueprint targets in this slice.

## Effects

- An operator can add, place, aim, color, and dim directional and point lights, and can turn each light on or off for characters, props, and the environment. A character can cast a shadow on the environment floor.
- The show format gets one entity kind and one optional environment field. The call API gets two patch operations (`setLight` and `setEnvironmentReflections`). An old show loads and renders without change.
- MCP reaches each light through `scene_patch` and `scene_inspect`.

## Risks

- A change to the light set recompiles each lit material. This can cause a frame hitch in the preview and in OBS. The cost is unknown until the owner measures it on macOS.
- Shadows cost one extra render for each directional shadow and six for each point shadow. The cost on a real GPU is unknown. The cloud can check only that a shadow shows on a software adapter.
- MToon in `@pixiv/three-vrm` 3.5.5 must accept `lightsNode` and receive shadows. The implementation run checks this first in a headless render. If MToon does not accept `lightsNode`, it stops and asks the owner.
- A fixed 20 m shadow box gives no shadow outside that box in a large environment.
- The handbook gives no defaults or ranges. The values in the contract are OpenSekai choices.
- The built-in light returns when the last light is removed. This differs from Warudo, where a scene without lights is dark.

## Out of scope

Volumetric and spot lights (ENV-08), import of file lights, Allow Lights To Affect Characters, Apply Environment Lighting, ambient source and other environment overrides (ENV-02), reflection probes, baked lightmaps, light cookies, Blueprint targets for color and shadows, and a light gallery.
