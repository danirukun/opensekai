# Character Debug section analysis

Date: 2026-11-20. Scope: an owner request on the lilToon on WebGPU branch. Contract: [character Debug section](../prompt/2026-11-20-character-debug-section.md).

## Sources

- The owner request: "on character assets, give me a debug section (folded by default) which exposes key information about e.g. the gltf extensions on the vrm etc., kind of like https://three-liltoon.mochiya.org/".
- The reference viewer, `examples/mochiya-liltoon-viewer/src/components/viewer/material-inspector.tsx` in the three-liltoon repository. It shows a material picker, the Mochiya extension and its lilToon version and shader variant, a property search, the textures with size, color space, flip, wrap, and filter, and the rendering warnings.
- The owner approved option 1 (the data comes from the parsed file at load time in TypeScript, with no Rust or record change) and this content: file, extensions, meta, counts, materials (picker, profile, extensions, lilToon spec version, lilToon version, shader variant, queue, alpha mode, cull, a searchable property list, textures with size and color space), the load warnings of the file, and one Copy button for JSON.

## Current state

- **No asset Inspector.** The Inspector shows entities. A character is an `avatar` entity with `assetId`. Its sections are Transform, Model, Expressions (optional), Meshes (optional), Lighting, and Tracking (`editor/inspector-sections.ts`).
- **The loader drops the JSON.** `createAssetLoader` (`packages/renderer/src/assets.ts`) reads the GLB JSON with `inspectContainer`, builds the material report and the warnings, parses the file, and returns `{scene, vrm, meshes, warnings, dispose}`. The JSON is not kept.
- **Image decode** goes through the `loadImageSource` wrapper of the loader. The lilToon material gives each texture through `getTexture(name)` and sets its color space from the lilToon texture semantics. The MToon and PBR materials keep their textures in plain fields (`map`, `normalMap`, `shadeMultiplyTexture`, and so on).
- **Load status.** The renderer sends `AssetLoadStatus[]` through `onLoadStatus`. A ready job leaves that list. The Inspector gets `loads`. The editor collects frame warnings with `ids:[assetId]`.
- **The asset record** (`AssetRecord`) has `sha256` and `bytes`. The Inspector gets `assets`.
- **Collapse state.** `opensekai.inspector.sections` keeps the literal list of collapsed sections. A stored valid value replaces the start state. A section that starts collapsed thus shows expanded for a user who has a stored value from before.

## Decisions

1. **Place.** A last section, Debug, in the Inspector of an avatar with a model. A prop or an environment does not get it in this slice.
2. **Data path.** A pure function in `@opensekai/contracts` reads the GLB JSON. The renderer keeps its result with the live texture details and the load warnings of the asset, and gives it through `modelInfo(assetId)`. No IPC, no Rust change, no record change, no schema change. Alternative: compute it in Rust at import and keep it in the asset record. That changes the record schema for a debug view.
3. **Start folded.** The Debug section starts collapsed for each user, also for a user with a stored state. The state keeps a second list, `opened`, of the sections that start collapsed and that the user opened. Alternative: a version 2 state. That resets the other sections of each user.
4. **Copy.** One button copies the JSON of the shown data. The values in the panel and in the copy are the same.
5. **Bounds.** The lists and the strings have fixed upper sizes, so a large or hostile file cannot make the panel or the copy large.
