# REASONS: Test stage

Date: 2026-10-18. Scope: the environment fixture `fixture_test_stage`, for visual checks of ENV-01, ENV-07, CAM-07, CAM-13, and MED-05. Analysis: [test stage](../analysis/2026-10-18-test-stage.md). Depends on: [environment import](2026-10-13-environment-import.md), [stage lights](2026-10-18-stage-lights.md).

The owner approved this contract with the implementation plan on 2026-10-18. It adds a fixture and a build script. It does not change product behavior.

## R — Requirements

All positions are in glTF coordinates: metres, +Y up, and the avatar at the origin faces +Z.

### Layout

- **R1. Floor.** The floor is a 10 × 10 m plane at y = 0, for x and z from −5 to 5.
  - Its texture is 18 % grey (linear 0.18).
  - It has major grid lines every 1 m and minor lines every 0.5 m.
  - The +X axis is red and the +Z axis is blue, each with an arrow and a label.
  - It has an origin mark and a metre number on each axis.
  - It has camera marks on +Z at 1, 2, 3, and 4 m.
- **R2. Walls.** Each wall is a grey box (linear 0.18), 4 m tall and 0.1 m thick, outside the floor edge.
  - The back wall covers x from −5.1 to 5 and z from −5.1 to −5.
  - The left wall covers x from −5.1 to −5 and z from −5 to 5.
  - The +X and +Z sides are open.
- **R3. Back wall panels.** These panels are 5 mm in front of the back wall:
  - **Resolution chart**: unlit, 2 × 1.125 m (16:9), centred at (0, 1.6). It has these parts:
    - two hyperbolic wedges from 200 to 1000 LW/PH;
    - bar groups from 300 to 1100 LW/PH;
    - two slanted edges at 5°;
    - Siemens stars;
    - a centre cross;
    - 93 % and 90 % frames.
    - LW/PH is relative to the chart height.
  - **Siemens star**: lit, 36 cycles, 1 m, centred at (−1.9, 1.6).
  - **Zone plate**: lit, 1 m, centred at (1.9, 1.6). Its local frequency reaches 0.5 cycle per texel at the edge.
  - **Colour checker**: lit, 1.2 × 0.9 m, centred at (3.85, 1.6). It has the 24 ColorChecker Classic sRGB patches and an 11-step grey wedge in linear steps of 10 %.
- **R4. Green cove.** The cove uses chroma green (sRGB 0, 177, 64), lit, with roughness 1 and specular 0. It is 5 mm in front of the left wall, for z from −4.5 to 0.5.
  - The wall part rises to 3.5 m.
  - It curves with a 0.75 m radius into a floor part that reaches x = −2, 5 mm above the floor.
- **R5. Height ruler.** The ruler is on the left wall at z = 1.2. It is 0.375 m wide and 3 m tall, from y = 0. It has a mark every 0.1 m and a number every 0.5 m.
- **R6. Focus targets.** There are three Siemens-star boards, each 0.6 m square, facing +Z, centred at y = 0.85, on posts.
  - They stand at (1.2, z = −1), (2.0, z = −2.5), and (2.8, z = −4).
  - A camera at (0, 1.6, 6) sees all wall panels above them.
- **R7. Shadow props.** The props are:
  - a 0.5 m cube centred at (−1.4, z = −4);
  - a sphere of 0.25 m radius at (−0.6, 0.25, −4.1);
  - a pole 2 m tall and 0.05 m wide at (−2.3, z = −4.6);
  - three steps of 0.15 m at x from −1.3 to −0.7 and z from −3.3 to −2.55;
  - a 0.6 m plate 0.02 m above the floor at (3.5, z = 0.5).
- **R8. Reference balls.** Two balls of 0.15 m radius are at y = 1.2 and z = −1, on posts: chrome (metallic 1, roughness 0.05) at x = −1.6, and matte 18 % grey at x = −1.1.
- **R9. PBR swatch.** A 2 × 2 m patch centred at (3, 0.002, 3) uses PolyHaven Concrete Floor 02 (CC0) at 1k: the colour, normal (OpenGL), and roughness maps.

### File

- **R10. GLB.** The output is one GLB that passes `scripts/gltf-validate.ts` with 0 errors and 0 warnings.
  - It has no `uri`.
  - It has no `extensionsRequired` entry outside the importer support list.
  - It has no lights and no cameras.
  - Every image is PNG or JPEG.
  - It imports through `import_scene` without change.
- **R11. Budgets.**
  - No texture is larger than 2048 px on a side.
  - Chart textures are PNG.
  - The GLB is smaller than 25 MB.
- **R12. Credits.** `asset.extras` is `{ title: "OpenSekai Test Stage", author: "Oshi Connect", license: "CC0-1.0" }` with no `source`.

### Build and fixture

- **R13. Build script.** `scripts/test-stage/build_test_stage.py` builds R1 to R12 in Blender 5.2 or later.
  - Headless use: `--background --factory-startup --python <script> -- --out <glb> --maps <dir>`.
  - In a live Blender, `build(out, maps, directory)` builds the scene `OpenSekai Test Stage`. A rebuild removes only the data blocks that the script tagged.
  - The script prints a report: the object count, the materials, the image sizes, and the bounds in glTF axes.
- **R14. Build command.** `pnpm build:test-stage [--out <file>]` does these steps:
  - downloads the three PolyHaven maps into `fixtures/local/cache/test-stage/` and checks each SHA-256;
  - runs Blender (`BLENDER` or `/Applications/Blender.app/Contents/MacOS/Blender`);
  - runs the glTF validator;
  - prints the byte count and the SHA-256.
  - The default output is `fixtures/local/cache/test-stage/test-stage.glb`. It is not `fixtures/local/test-stage.glb`, because that path holds the pinned fixture revision.
- **R15. Fixture.** `fixtures/cloud/manifest.json` has `fixture_test_stage`:
  - file `test-stage.glb`, key `sha256/<hash>.glb`, format `glb`;
  - the R12 credits, with licence label `CC0-1.0`.
  - `fixtures/cloud/source-policy.md` records the source and the inputs.
- **R16. Public copy.** The same bytes are public at `https://assets.oshi-connect.net/opensekai/test-stage/opensekai-test-stage-fbeb8623.glb`, in the R2 bucket `assets`.
  - It is served as `model/gltf-binary` with `Content-Disposition: attachment` and an immutable cache.
  - The file name includes the first 8 characters of the SHA-256, so a new revision gets a new URL.
  - The README links to it and gives the SHA-256.
  - The private fixture bucket stays private, because it also holds a file whose licence prohibits redistribution.
- **R17. Example show.** `fixtures/shows/test-stage.osekai` is saved by the app. It has these entities:
  - the environment at `scene_6eb170021aa3c791a7f1665b25076754f9d2c2262568f9fdd720b6c4f381d1ee`, which is the library ID that an editor import of the R16 file gives;
  - the avatar Performer with no model;
  - the sun (directional, 2.5, shadow), the Cove Spot (spot, 120, 45°, shadow), and the Fill (ambient, 0.4);
  - the cameras Wide (output), Chart, Cove, and Corner, as in the evidence.
  - The show-open test reads it.

## E — Entities

- `fixture_test_stage`: an `AssetRecord` of format `glb` in the cloud manifest. It is loaded through fixture mode as an environment model.
- Chart images: `floor grid` (2048²), `resolution chart` (2048 × 1152), `siemens star` (2048²), `zone plate` (2048²), `colour checker` (2048 × 1536), `height ruler` (256 × 2048).
- Materials: one each for the walls, props, chrome, 18 % grey, chroma green, PBR swatch, and each chart.

## A — Approach

Author the stage in the owner's running Blender through the Lab MCP, and render check views with a temporary sun and spot light. Then build headless, validate, and upload to R2. Then load the stage in the running app with MCP and check it in the preview, in screenshots, and in OBS.

## S — Structure

- `scripts/test-stage/build_test_stage.py` (new), `scripts/build-test-stage.ts` (new), `package.json`.
- `fixtures/cloud/manifest.json`, `fixtures/cloud/source-policy.md`, `fixtures/shows/test-stage.osekai`, `apps/desktop/src-tauri/src/show.rs` (the show-open test).
- `README.md` (download link).
- `docs/testing.md`, `ARCHITECTURE.md`, `docs/evaluation/test-stage.md` (new).

## O — Operations

1. Build the stage in the live Blender. Render the wide, chart, cove, corner, and top views. Read the report bounds against R1 to R9.
2. Run `pnpm build:test-stage`, then `gltf-transform inspect`.
3. Upload the GLB to R2, add the manifest entry, run `prepare-fixtures.ts`, then `cargo test -p opensekai-desktop --lib prepared_local_fixtures`.
4. In the running app (fixture mode, MCP):
   - set the environment and the fixture avatar;
   - add a directional light and a spot light, both with shadows;
   - add the wide, chart, and cove cameras;
   - take a screenshot from each camera, at `preview_v1` and `production_v1` where it matters;
   - sample the cove green;
   - take a screenshot with Render Environment off;
   - take an OBS capture.
5. Import the GLB once through Add › Environment › Import file…, and check the credits.
6. Write `docs/evaluation/test-stage.md`.

## N — Norms

- No product code changes.
- The fixture bytes stay out of git. Screenshots of renders are evidence.
- Python follows the Blender API style. TypeScript follows `scripts/prepare-fixtures.ts`.

## S — Safeguards

- Do not change a live Blender scene other than `OpenSekai Test Stage`, and do not remove data blocks that the script did not tag.
- Do not commit the GLB or the PolyHaven maps.
- Do not make the private fixture bucket public.
- Do not claim a chroma-key or depth-of-field result. Those features do not exist yet.
- Record a measurement that was not taken as unknown.
