# Environment import analysis

Date: 2026-10-13. Scope: ENV-01 partial, slice 1 of the environment work. Design: [environment import](../../docs/superpowers/specs/2026-10-13-environment-import-design.md).

## Problem

The operator wants a 3D room or stage behind the character on stream, as in Warudo and other 3D editors. The reference file is a Sketchfab download in a folder: `scene.gltf`, `scene.bin`, and 37 PNG textures (138 MB). The operator also wants a Sketchfab search and download in the app, and a basic skybox.

The current code cannot load this file:

- The VRM importer is the only import. It rejects any `uri` key.
- `validate_glb` in the asset service rejects a URI that is not `data:`.
- The renderer `inspectContainer` rejects external buffers and images.
- The import limit is 128 MB.
- The scene has no environment kind. The `mesh` kind has no create UI.
- Scene lighting is one fixed ambient light and one fixed directional light. The scene has no environment map, so glossy PBR surfaces render almost black.

Warudo has one Environment asset for each scene, with a Source model, and a Render Environment setting on each camera (reviewed 2026-10-13).

## Decisions

The operator chose these in the design review:

- Do local import first. Do Sketchfab after it, because Sketchfab uses the same importer and needs a client ID from Sketchfab.
- Raise the import limit. The packed limit is 256 MB for all imports.
- One environment in each scene. Imported scene assets are general GLB assets, so props can use them later.
- Keep the existing lights. Add a neutral environment map to the environment materials only.
- Import through the editor dialog only. MCP cannot import a file.
- Pack multi-file glTF to one GLB in Rust at import. Keep the three URI checks.

## Effects

- Old shows open without change. A show with an environment does not open in an older build.
- The 64-entity scene limit counts the environment.
- With an environment and Render Environment on, the OBS output is opaque where the environment covers the frame. The existing transparent output stays the same when the scene has no environment or the flag is off.
- WebKit memory increases with the environment textures. The live check must measure the operator avatar and the sample together.
- The asset record keeps credits. CC-BY sample content needs credit on stream; the operator copies it from the Inspector.

## Risks

- A large environment can exceed the WebKit 4 GB limit with an avatar. The texture limits reduce this. The live check decides whether the slice is accepted.
- Some environments are not at a useful scale or position. The operator uses the transform. The slice does not add automatic fit.
- Some environments use Draco, meshopt, or KTX2. The importer rejects them with a clear message in this slice.

## Out of scope

Props, light entities, sky and background, Sketchfab, drag and drop, MCP import, import cancellation, texture compression, and the Warudo environment lighting settings.
