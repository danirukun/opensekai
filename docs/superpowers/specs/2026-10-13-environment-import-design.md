# Environment import design

Date: 2026-10-13. Scope: ENV-01 partial (slice 1). The design also records the order and the open choices for ENV-02 (slice 2) and ENV-11 (slice 3). References: the [Warudo Environment page](https://docs.warudo.app/docs/assets/environment) and the [Warudo Camera page](https://docs.warudo.app/docs/assets/camera), reviewed 2026-10-13. The detailed contract is [spdd/prompt/2026-10-13-environment-import.md](../../../spdd/prompt/2026-10-13-environment-import.md). The analysis is [spdd/analysis/2026-10-13-environment-import.md](../../../spdd/analysis/2026-10-13-environment-import.md).

## Problem

An operator cannot put a 3D room or stage behind a character. The scene has cameras, characters, tracking sources, and a placeholder mesh kind with no create UI. The asset library accepts only a single-file VRM. The importer, the loopback asset service, and the renderer each reject a glTF file with external buffers or images.

Most free environments come as a multi-file glTF: `scene.gltf`, `scene.bin`, and a `textures/` folder. The Sketchfab download archive has the same layout. The reference sample is "Anime stylized room free" by CG Lads, CC-BY-4.0 ([source](https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d)). It has 225 nodes, 104 meshes, 14 opaque materials, and 37 PNG textures, and it uses 138 MB on disk. It uses the optional extension `KHR_materials_specular`. Its `asset.extras` holds the title, author, license, and source URL.

Warudo has one Environment asset for each scene. It has a **Source** model and lighting settings. The Warudo camera has **Render Environment**. When it is off, the camera does not draw the environment, but environment lighting stays on characters. Warudo does not recommend that the operator moves an environment.

## Slices

1. **Environment from local files** (this design, ENV-01 partial). Import a `.glb`, a `.gltf` with its files, or a `.zip`. Draw one environment behind the characters. Add Render Environment for each camera.
2. **Sky and background** (ENV-02 subset). A solid color, an equirectangular image, or an HDR image as the camera background. Optional image-based lighting from that image. It replaces the neutral environment map of slice 1. A later contract defines it.
3. **Sketchfab models** (ENV-11, OpenSekai addition, Different API). Search downloadable models, sign in, download the glTF archive, and import it through the slice 1 importer. Show the license, the author, and "provided by Sketchfab". A later contract defines it. See [Slice 3 candidates](#slice-3-candidates).

Slice 3 depends on slice 1. Slice 2 is independent of slice 3.

## Decisions (slice 1)

1. **One environment in each scene.** A new entity kind `environment` has the base fields (`id`, `name`, `visible`, `transform`) and `assetId: Id | null`. Scene validation allows at most one. A second environment is not available.
2. **Shared scene asset.** The importer makes a general GLB scene asset with the ID `scene_<sha256>`. It does not make an environment-only format. ENV-03 props can use the same assets later.
3. **Pack to one GLB in Rust.** The importer resolves each external buffer and image, embeds it, and writes one self-contained GLB. The asset service, `validate_glb`, and the renderer `inspectContainer` continue to reject external URIs. Thus the trusted load path does not change.
4. **Editor import only.** A new editor-only command `import_scene` opens a native dialog for `.glb`, `.gltf`, and `.zip`. The frontend cannot send a path. MCP cannot import a file. MCP can set an imported asset on the environment through `scene_patch`.
5. **Neutral lighting for the environment.** The existing ambient and directional lights stay. Each renderer client makes one neutral prefiltered environment map from three.js `RoomEnvironment` and sets it as `envMap` on the lit (standard or physical) environment materials only. Unlit materials keep their look. `scene.environment` stays null. The character appearance does not change. Lights from the file (`KHR_lights_punctual`) are not imported; ENV-07 owns light entities.
6. **Render Environment for each camera.** A camera has an optional `renderEnvironment` flag. Absent means true. Each renderer client (the Scene window preview and the OBS output) draws through its output camera, and hides the environment when that camera's flag is false.
7. **Credits.** The asset record keeps an optional `credits: { title, author, license, sourceUrl }` from `asset.extras`. The Inspector shows the title, the author, and the license, and has one **Copy credit** action. The copied line includes the source URL. The app has no link opener, so the Inspector shows no link. CC-BY requires credit wherever the work is shared, and that includes a stream.
8. **Import size.** The packed GLB limit is 256 MB for every import, VRM included (was 128 MB). The GLB JSON limit stays 16 MB. The real limit is decoded texture memory in the WebKit process (4 GB). The live check measures it.

## Data model

TypeScript (`packages/contracts`) and Rust (`crates/contracts`) change together with shared validation vectors. `schemaVersion` stays 1. Existing shows open without change.

- `SceneEntity` adds `{ kind: 'environment', assetId: Id | null }` on the base fields.
- Camera adds optional `renderEnvironment: boolean`.
- `PatchOp` adds `setEnvironmentModel { entityId, assetId: Id | null }` and `setCameraRenderEnvironment { entityId, renderEnvironment }`. Transform and visibility use the existing `setTransform` and `setVisibility`.
- `AssetRecord` adds an optional key `credits: { title: string | null, author: string | null, license: string | null, sourceUrl: string | null }`. An absent key means no credits. The existing `sourceUrl` and `licenseLabel` stay and get the same values, so older code that reads them still works. `importerVersion` stays 1.
- A show keeps an environment with an unknown `assetId` as a repairable reference, as for characters.

## Import

`apps/desktop/src-tauri/src/assets/scene_import.rs` holds a pure `pack_scene` function with the file system access behind a small source trait (folder or zip). The registry stores the result.

1. **Root file.** A `.glb` or `.gltf` is the root. A `.zip` must hold exactly one `.gltf` or `.glb` at the archive root or one folder below it.
2. **References.** `data:` URIs are decoded. A relative URI is percent-decoded and resolved below the root folder (or the zip folder of the root file). The importer rejects an absolute path, a `..` that leaves the root, a symlink to a target outside the root, any other URI scheme, and a zip entry name that leaves the archive.
3. **Zip limits.** At most 4096 entries and at most 1 GiB uncompressed. The importer reads only the entries that the root file refers to.
4. **Images.** PNG, JPEG, and WebP, checked by magic bytes. The importer rejects other types.
5. **Required extensions.** The importer rejects a file with an entry in `extensionsRequired` that the renderer does not support, and names it. It rejects `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, and `KHR_texture_basisu` in this slice. Optional extensions pass through. The importer removes `KHR_lights_punctual`, so the file lights do not load (ENV-07 owns lights).
6. **Pack.** All buffers and images go into one BIN chunk with 4-byte alignment. Image references become `bufferView` plus `mimeType`. No `uri` remains. The result must pass `validate_glb`.
7. **Store.** The file is `scene_<sha256>.glb` with its JSON record, written to a temporary file and renamed. An import of the same content returns the existing record. The name is `credits.title`, else the root file stem. The importer does not change the source files.
8. **Work.** The import runs on a blocking task, not on the UI thread or the render path. Peak memory is a few copies of the packed output (source bytes, buffers, and the output), bounded by the 256 MiB read budget.

The importer returns typed `AppError` codes. This slice has no cancel control. A local import of the sample is expected to take a few seconds; the evaluation records the measured time.

## Rendering

- `submit` reconciles the environment like an asset mesh: a background load job, the load status overlay, `compileAsync` before the model joins the scene, and stale-result disposal. The existing texture limits apply (1024 pixels for the preview, 2048 pixels for the output).
- A failed load shows in the overlay and in the frame warnings. The scene continues without the environment.
- The map applies to lit (standard or physical) materials. Unlit materials keep their look.
- The neutral environment map is made once for each renderer client and released with the renderer.
- The environment is not a pick target in the viewport. The operator selects it in the Hierarchy. The transform gizmo then applies.
- Output alpha is 1 where the environment covers a pixel. Pixels that the environment does not cover stay transparent until slice 2.
- The environment is static scene state. It does not change the authoritative simulation.

## Editor and MCP

- **Add › Environment** creates `Environment` with `assetId: null`. The item is disabled while the scene has an environment.
- The Hierarchy has an **Environment** group before **Cameras**.
- The Inspector for an environment shows Name, Visible, Transform, and a **Source** select. The options are `Choose model…`, the imported scene assets, `Missing model` for an unknown asset, and `Import file…`, which opens `import_scene`. A selection sends `setEnvironmentModel`.
- When the asset has credits, the Inspector shows the title, the author, the license, and **Copy credit**. The copied line uses the CC form from the sample `license.txt`: `This work is based on "<title>" (<source>) by <author> licensed under <license>`.
- The camera Inspector adds a **Render Environment** switch.
- MCP uses `scene_patch` for the new operations. `scene_inspect` and asset records show the environment, the flag, and the credits.

## Testing and evidence

- **Rust unit tests** for `pack_scene`: multi-file glTF, `data:` URIs, percent-encoded names, Sketchfab zip layout, each rejection in the Import list, credits, the name fallback, and deduplication.
- **TypeScript unit tests**: one-environment validation, the `renderEnvironment` default, the two operations, and the credit line.
- **Integration test** (real file and loopback service boundary): the test writes a small multi-file glTF (JSON, `.bin`, and a PNG made with the `png` crate) to a temporary folder, imports it through the service, reads it through `GET /assets/{id}`, and checks that the served GLB has no `uri`, that each image has a `bufferView` and a `mimeType`, and that the record survives a service restart. The renderer `inspectContainer` makes the same no-URI check. The sample room is not committed because of its size.
- **Live macOS check** with computer use and MCP: Add › Environment; import the sample `scene.gltf`, then the same sample as a zip; check reflections on glossy surfaces and an unchanged character; Save As and Open; remove the library file and see `Missing model`; OBS capture with Render Environment on and off (off must match the current transparent alpha); WebKit memory with the operator avatar and the sample loaded; app and OBS timing kept separate; motion while the editor is minimized. Record the backend, quality profile, commit, and sample source URL. A value that is not measured is unknown.

## Out of scope (slice 1)

Props and attachments (ENV-03), light entities and file lights (ENV-07), sky and background (ENV-02), Sketchfab (ENV-11), drag and drop, MCP import, import cancellation, texture compression (KTX2, candidate with a later selection gate), mesh merge or LOD, colliders, Warudo **Allow Lights To Affect Characters**, **Ambient Lighting Source**, and **Environment Reflections Intensity**.

## Slice 3 candidates

These are not decisions. Slice 3 selects one with a gate.

- **Sign-in.** Sketchfab requires that the end user signs in inside the app. OAuth 2 authorization code with a loopback redirect (`http://127.0.0.1:<port>`) is allowed. A client ID needs a request to Sketchfab. A personal API token is a fallback candidate. Gate: Sketchfab grants a client ID, or a test shows that the download endpoint accepts the token, and the terms permit that use.
- **Token storage.** The macOS Keychain behind a credential adapter. The app has no secret storage now.
- **Network.** The Rust host makes the API calls. The WebView CSP stays closed to external hosts. Download URLs expire after 300 s and are not cached.
- **Attribution.** The model license and author link, plus "provided by Sketchfab", come from the `credits` group of slice 1.
