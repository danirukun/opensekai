# REASONS: Image screens

Date: 2026-11-04. Scope: MED-01 slice 1. A Screen entity that shows one PNG, JPEG, WebP, or GIF image from the asset library, with its transparency, in the editor, the preview, screenshots, and the OBS output. Analysis: [image screens](../analysis/2026-11-04-image-screens.md). Issue: [GitHub #59](https://github.com/danirukun/opensekai/issues/59).

## R — Requirements

### Assets

R1. `AssetRecord.format` adds `png`, `jpeg`, `webp`, and `gif` in TypeScript (zod) and Rust. An image record has the optional group `image: { width, height, frames }` (integers; `width` and `height` 1 to 8192; `frames` 1 or more, 1 for each type except an animated GIF). A GLB or VRM record has no `image` group, and an image record has no `expressions` content, `rig`, `eyeBones`, or `meshes` (it keeps the required `expressions` key empty). Old records validate without change.
R2. The ID of an image record is `image_` plus the SHA-256 of the stored bytes. The library file is `<app local data>/assets/library/<id>.<ext>` with the extension `png`, `jpg`, `webp`, or `gif`. `AssetSummary.kind` adds `image` (TypeScript and Rust), from the `image_` prefix.
R3. A new editor-only Tauri command `import_image` opens a native dialog (title `Import image`, filter `Image` with `png`, `jpg`, `jpeg`, `webp`, `gif`; no filter label on macOS, as for the other imports). The frontend never sends a path. The command returns the record, as `import_scene` does, and the host sends the `asset-record` event.
R4. The host reads the file with a budget of 64 MiB and finds the type from the signature only, not from the extension: PNG (`89 50 4E 47 0D 0A 1A 0A` and an `IHDR` first chunk), JPEG (`FF D8 FF`, size from the first SOF0 to SOF15 marker except DHT, JPG, and DAC), WebP (`RIFF` … `WEBP` with a `VP8 `, `VP8L`, or `VP8X` chunk), and GIF (`GIF87a` or `GIF89a`, the logical screen size, and the count of image descriptors). A file with another signature, a truncated header, a size of 0, or a width or height above 8192 fails with `INVALID_INPUT` and a message that names the reason. The host does not decode pixels. The parse is a pure Rust function in `assets/image.rs` with no new crate.
R5. The record name is the file stem, cut to 128 code units, or `Image` when the stem is empty. The same bytes return the existing record (the deduplication of `AssetRegistry::commit`). Staging and the registry lock follow the scene import (`stage_*` without the lock, `commit` with it).
R6. `GET /assets/{id}` answers an image record with `content-type` `image/png`, `image/jpeg`, `image/webp`, or `image/gif` and `x-content-type-options: nosniff`. Before it answers, the service checks the size and the SHA-256, as for a GLB, and runs the R4 header check again in place of `validate_glb`. A GLB or VRM record keeps `model/gltf-binary` and `validate_glb`.
R7. The trust rule in `ARCHITECTURE.md` changes to: a stored asset is one self-contained GLB container, or one PNG, JPEG, WebP, or GIF file whose signature and header the host checks at import and at serve, and the renderer checks at load (R12). No path or URL from an image file is ever followed.

### Scene

R8. A new entity kind `screen` in TypeScript (zod) and Rust: `{ id, name, visible, transform, kind: 'screen', content: { kind: 'image', assetId: Id | null } }`. `content` is a discriminated union with one member in this slice. A scene has at most 16 screens (`LIMITS.screens`). A show without a screen validates without change.
R9. The operation `setScreenImage { entityId, assetId: Id | null }` sets `content` to `{ kind: 'image', assetId }`. It fails with `NOT_FOUND` for an unknown entity and with `INVALID_INPUT` for an entity that is not a screen. It is in `PatchOp`, `LivePatchOp`, and the Rust `PatchOp`. The session does not check that the asset exists or that it is an image (as for `setMeshModel`); the renderer handles a wrong record (R13).
R10. The Blueprint property registry adds `screen` to Position, Rotation, Scale, and Visible. Get Asset Property, Set Asset Property, and Move Entity accept a screen, with transitions.

### Renderer

R11. For each visible screen with an `image` content and a non-null `assetId`, each renderer client (OBS page, scene pane preview, editor viewport, and screenshot) draws one quad. The quad is 1 m high and `1 × width / height` m wide from the decoded image, centered on the entity origin, in the local XY plane, facing local +Z. It shows the image upright and not mirrored from the front (+Z side). The back side shows the image mirrored. The entity transform applies. A screen with `assetId: null` draws nothing.
R12. The renderer loads an image record with `readAsset`, checks the signature again (same four types as R4), and decodes it with `createImageBitmap` into a texture. The longest side is scaled down to the `maxTextureSize` of the quality profile, as the image resize policy does for model textures. The texture color space is sRGB. A GIF shows its first frame only. The bitmap is closed and the texture disposed when no screen uses the asset.
R13. A load failure (unknown asset, a GLB or VRM record, a bad signature, or a decode failure) draws nothing for that screen and reports `Image failed to load` through the existing load status for that entity. It does not stop the other entities. A loading image reports the existing `Asset loading` warning.
R14. The screen material is unlit (`MeshBasicMaterial` or its node equivalent). Lights, the room map, haze, and shadows do not change it. It does not cast or receive shadows. It is not in a light group. A change of lights does not rebuild it.
R15. Transparency. An image with an alpha channel (PNG with alpha or `tRNS`, WebP with alpha, GIF with a transparent index) draws with normal alpha blending and `depthWrite: false`. Each other image draws opaque. The texture keeps straight alpha (`createImageBitmap` with `premultiplyAlpha: 'none'`), and the material does the blend once. On the OBS page, a pixel where only a fully transparent part of a screen is in front of the cleared background has alpha 0. A pixel where an opaque part covers it has alpha 1. A half-transparent pixel over the cleared background has an alpha within 2/255 of the image alpha. The renderer decides "has alpha" from the decoded pixels once at load (any alpha below 255), not from the header.
R16. A screen is a viewport pick target. The transform gizmo moves, rotates, and scales it. It is drawn when the camera has `renderEnvironment: false`.

### Editor

R17. The Add menu has **Screen** after **Prop**. It creates `{ kind: 'screen', name: 'Screen', visible: true, content: { kind: 'image', assetId: null } }` with an identity transform. A second screen is `Screen 2`, as for the other kinds. The item is disabled at 16 screens or at the 64-entity scene limit.
R18. The Hierarchy groups screens under **Screens**, after **Props**.
R19. The Inspector for a screen shows Name, Visible, Transform, and a **Screen** section with **Image**: a select of the image records, the `Import file…` row, the load status, and the failure message, in the same form as the Prop **Source** field. A record option sends `setScreenImage`. `Import file…` runs `import_image`; a returned record sends `setScreenImage` for that screen only; a cancelled dialog keeps the value. An unknown `assetId` shows `Missing image`. The Inspector reset and the section index cover the section (B17).
R20. The Prop and Environment source selects do not list image records. The Screen select lists only image records.

### MCP and files

R21. MCP `scene_patch` accepts `createEntity` with a screen and `setScreenImage`. `asset_list` returns image summaries with `kind: 'image'`. The `asset_list` description names `setScreenImage`, and the `scene_patch` description says how to add a screen. There is no MCP image import.
R22. Save As and Open keep each screen and its content. A screen with an unknown `assetId` opens and shows `Missing image`.

## E — Entities

- `AssetRecord`: `format` adds `png | jpeg | webp | gif`; optional `image: { width, height, frames }`.
- `AssetSummary.kind`: adds `image`.
- `SceneEntity` (screen): `{ id, name, visible, transform, kind: 'screen', content: { kind: 'image', assetId: Id | null } }`.
- `PatchOp`: `setScreenImage { kind, entityId, assetId }`.
- `LIMITS.screens`: 16.
- `AddKind`: adds `screen`. `InspectorSection`: a screen has `transform` and `screen` (label `Screen`).

## A — Approach

Add one asset kind and one entity kind, and reuse the prop paths for each step. The host checks only the signature and the header of the image; the renderer decodes it with the browser. The screen is one unlit quad with one texture for each asset in each renderer client, shared by the screens that use it. `content` is a union now, so B29 to B31 add members and do not change the entity shape. No image data goes through Tauri IPC; the renderer reads the bytes over `GET /assets/{id}`, as for models.

## S — Structure

- `packages/contracts`: `schema.ts` (`AssetRecordSchema`, `AssetSummarySchema`, screen entity, `PatchOpSchema`, `LIMITS.screens`, scene refine), `types.ts` (`LivePatchOp`), `property-registry.ts`.
- `crates/contracts`: `AssetFormat`, `AssetKind`, `AssetRecord.image`, `SceneEntity::Screen`, `ScreenContent`, `PatchOp::SetScreenImage`, the screen count check.
- `apps/desktop/src-tauri`: `assets/image.rs` (new: header parse), `assets/registry.rs` (`stage_image`, extension, ID prefix), `assets/mod.rs`, `service/mod.rs` (content type and serve check), `lib.rs` (`import_image` command, editor capability list and its permission test).
- `packages/session`: `scene-ops.ts` (`setScreenImage`).
- `packages/renderer`: `screen.ts` (new: signature check, decode, alpha scan, quad and material), `renderer.ts` (screen objects, pick targets, load status), `assets.ts` (an image cache next to the model cache).
- `apps/desktop/src`: `editor/live-fields.ts`, `editor/authoring.ts`, `editor/asset-groups.ts`, `editor/inspector-sections.ts`, `editor/property-defaults.ts`, `editor/model.ts` (`setScreenImage`, `importImage`), `components/Hierarchy.svelte`, `components/Inspector.svelte`, `EditorApp.svelte`.
- `apps/mcp/src/server.ts`: descriptions.
- `ARCHITECTURE.md`: the trust rule (R7), the asset path, and the renderer paragraph.

## O — Operations

1. Contracts: schemas, types, Rust mirror, and the round-trip and limit tests.
2. Host: `assets/image.rs` with unit tests for each type, each failure in R4, a GIF frame count, and a WebP `VP8X` size; `stage_image`, deduplication, and library reload tests; serve tests for the content type and a changed file.
3. Session: `setScreenImage` and its tests.
4. Renderer: unit tests for the signature check and the alpha rule (R15) on small fixture images built in the test; a headless Chromium render on the software adapter of a screen with a PNG that has an opaque half, a transparent half, and a half-alpha strip, with a pixel read of the alpha values in R15 on the OBS page, and the upright and back-mirrored orientation (R11). Commit the test images as small generated files, not third-party images.
5. Editor: Add item, factory, group, sections, Inspector, model methods, import target, with unit tests for the pure parts and a headless browser check of the Add and Inspector flow where it runs without a GPU.
6. MCP descriptions and a `scene_patch` test with a screen.
7. macOS check by the owner (accept:local): `Import file…` with one PNG with alpha, one JPEG with EXIF orientation, one WebP with alpha, and one animated GIF; the Editor window (WebKit) and the OBS page (CEF) both show each image upright; the OBS source shows no halo or dark fringe on transparent edges over a colored OBS background; the gizmo; a Blueprint Set Asset Property transition on a screen; Save As and Open.
8. Evidence, `docs/warudo-parity.md` (MED-01 stays unchecked: GIF animation and macOS evidence remain), and `ARCHITECTURE.md`.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the labels in R3, R13, R17 to R19, and R22. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data. Follow the one-operation-for-each-property pattern. Do not commit third-party images. Store the image metadata as one nested group on the record (constitution rule 7).

## S — Safeguards

- Do not loosen the GLB trust checks. A GLB or VRM record keeps `validate_glb` and `inspectContainer`.
- Do not send image bytes or decoded pixels through Tauri IPC.
- Do not change the look of avatars, props, the environment, or the lights. A scene without a screen renders the same pixels as before.
- Do not add a Rust image decoding crate or a new vendor.
- Do not claim GIF animation, video, web pages, capture, Bend, Thickness, Crop, Corner Radius, Tint, Chroma Key, or Windows support from this slice.
- An old build does not open a show with a screen. Record this in the evidence.
