# Test stage evidence

Date: 2026-10-19. Contract: [test stage](../../spdd/prompt/2026-10-18-test-stage.md). Fixture: `fixture_test_stage`, SHA-256 `fbeb862301bc8a78851849b2b0bf750cbb5f570425efce889c28f41332655f6b`, 15,387,580 bytes.

Setup:
- Commit `e56a8f5` on branch `test-stage-fixture`.
- macOS 27.0.1 on an Apple M3 Pro.
- Blender 5.2.2 LTS.
- OBS 32.2.2.
- `OPENSEKAI_EVALUATION=1 OPENSEKAI_FIXTURE_MANIFEST=fixtures/local/manifest.json pnpm dev:desktop`.
- Renderer backend `webgpu`.
- The Scene preview and `camera_screenshot` use `preview_v1`. The OBS output uses `production_v1`.

## Blender

- **Live build through the Lab MCP.** The script built the scene `OpenSekai Test Stage` in the owner's running Blender in about 3 s. A second build removed only the tagged data blocks, and the material names stayed without a `.001` suffix.
- **Check renders.** EEVEE rendered five views (wide, chart, cove, corner, top) with a temporary sun and spot light. The script removed both lights after the renders.
  - [Blender wide](test-stage/blender-wide.png)
  - [Blender cove](test-stage/blender-cove.png)
- **Report bounds** (glTF axes) agree with R1 to R9:
  - floor −5…5;
  - back wall z −5.1…−5 and left wall x −5.1…−5, both 4 m tall;
  - cove x −4.995…−2, y up to 3.5, z −4.5…0.5;
  - resolution chart 2 × 1.124 m centred at y 1.6;
  - focus targets at y 0.55…1.15.
- **Colour.** A rendered colour checker patch reads back as sRGB (115, 82, 68) for "dark skin" (target 115, 82, 68) and (8, 133, 160) for "cyan" (target 8, 133, 161).
- **Headless build.** `pnpm build:test-stage` took 5.8 s. `gltf-validate` gave 0 errors and 0 warnings.
  - `extensionsUsed`: `KHR_materials_specular` and `KHR_materials_unlit`.
  - No `extensionsRequired`, no `uri`, and no lights or cameras.
  - 30 meshes, 12 materials, and 9 images (PNG, plus the two JPEG PolyHaven maps). The largest image is 2048 px.
- **Re-import.** Importing the GLB into an empty Blender gave 30 objects and 12 materials. The resolution chart came back as Blender's unlit setup (Light Path mixed with Emission and Transparent).
- **Rebuilds are not byte-identical.** Two builds had the same size and different SHA-256, so the manifest pins the uploaded file (contract R14 and R15).

## Fixture

- The GLB is in R2 as `opensekai-fixtures/sha256/fbeb86….glb`. A download from R2 gave the same SHA-256 and byte count.
- `prepare-fixtures.ts` listed `fixture_test_stage` as ready.
- `cargo test -p opensekai-desktop --lib prepared_local_fixtures`: 1 passed.

## OpenSekai

The scene was built with MCP `scene_patch` from the fixture-mode smoke scene:
- the environment `fixture_test_stage`;
- the avatar `fixture_vrm_1` at the origin;
- a directional light (intensity 2.5) and a spot light aimed at the cove (intensity 120, range 15, 45°), both with shadows;
- an ambient fill of 0.4;
- the cameras `camera_wide` (0, 1.6, 6), Chart (0, 1.6, −2), Cove (1.5, 1.4, −2), and Corner (4.5, 3, 4.5).

| Check | Result | Evidence |
| --- | --- | --- |
| `asset_list` lists the fixture with its credits | Pass | `fixture_test_stage`, "OpenSekai Test Stage", CC0-1.0 |
| The stage loads as the environment | Pass | No `Asset loading` warning after load. [App wide](test-stage/app-wide.png) |
| Shadows on the floor and on the cove | Pass | The avatar, the posts, and the focus targets cast directional shadows on the floor. The ball shadows from the spot light fall on the cove floor. [App cove](test-stage/app-cove.png) |
| Scale | Pass | In the wide view, the avatar stands on the origin mark, and the 1 m grid and camera marks line up with the stage. |
| Chart resolution, `preview_v1` (`camera_screenshot`) | Pass, measured | The bar groups resolve to about 500 LW/PH. Above 600 they turn grey, because the preview caps the texture at 1024 px. [Preview bars](test-stage/chart-bars-preview_v1.png) |
| Chart resolution, `production_v1` (OBS) | Pass, measured | All bar groups to 1100 LW/PH show separate bars, with aliasing above about 800. [OBS bars](test-stage/chart-bars-production_v1-obs.png), [OBS chart](test-stage/obs-chart-production_v1.png) |
| Zone plate | Observed | In the wide and corner views it shows moiré rings, as an aliasing target should. |
| Green cove uniformity | Measured | See the table below. |
| Render Environment off | Pass | `camera_wide` with the flag off: 0.82 % of the pixels have alpha > 0 (the avatar only). [Transparent](test-stage/app-wide-render-environment-off.png) |
| Editor import (Add › Environment › Source › Import file…) | Pass | The dialog imported `fixtures/local/test-stage.glb` as `scene_6eb17002…`, which differs from the file hash because the importer repacks the GLB. The Source shows "OpenSekai Test Stage", and the Inspector shows the title, author, licence, and Copy credit. [Corner from the imported copy](test-stage/app-corner-imported.png) |
| OBS output | Pass | The isolated QA scene in OBS showed the Chart camera at `production_v1`. Teardown restored the program scene "Scene". |
| `capture_frame` with the stage visible | Fail (open) | `STALE_FRAME` "Capture frame is not current" on 6 tries. With the stage hidden (`setVisibility false`), the same call succeeded. With the stage visible, `output_main` acknowledged frames at 60 per second (323 frames in 5.4 s, `cpuMs` about 2). The cause is not known. |

Green cove, sampled in a 24 × 24 px box in the `preview_v1` Cove screenshot (sRGB mean):

| Area | RGB |
| --- | --- |
| Wall, outside the spot | (1, 119, 41) |
| Wall, spot centre | (1, 186, 68) |
| Curve | (1, 199, 73) |
| Floor, in the spot | (1, 216, 80) |
| Floor, ball shadow | (0, 158, 56) |

Red stays at 0 to 1, and B/G stays about 0.35 to 0.37. The green level changes from 119 to 216 across the cove, so a keyer must allow for falloff and shadows.

## Public copy and example show

Date: 2026-10-19. The app ran in normal mode (no fixture manifest), with `OPENSEKAI_EVALUATION=1`.

- **Public copy.** `https://assets.oshi-connect.net/opensekai/test-stage/opensekai-test-stage-fbeb8623.glb` returns HTTP 200 with these headers:
  - `content-type: model/gltf-binary`;
  - `content-length: 15387580`;
  - `content-disposition: attachment; filename=opensekai-test-stage.glb`;
  - `cache-control: public, max-age=31536000, immutable`.
  - A download has SHA-256 `fbeb8623…`, the same as the fixture.
- **Import of the download.** An editor import of the downloaded file from a scratch path (Add › Environment › Source › Import file…) gave `scene_6eb170021aa3c791a7f1665b25076754f9d2c2262568f9fdd720b6c4f381d1ee`. That is the same ID as the import of `fixtures/local/test-stage.glb`, and no new library record was added.
- **Save.** MCP `scene_patch` built the show: the environment, Performer with no model, the Sun, the Cove Spot, the Fill, and the Wide, Chart, Cove, and Corner cameras. The show name was set to "OpenSekai Test Stage". The editor Save button and the macOS save dialog wrote `fixtures/shows/test-stage.osekai` (9 entities).
- **Open.** After a change (Corner removed), the editor Open button and the open dialog read the file again. `scene_inspect` gave all 9 entities back, and a Corner screenshot showed the stage, the lights, and the shadows.
- **Test.** `cargo test -p opensekai-desktop --lib example_stage_show_opens` reads `stage-lights.osekai` and `test-stage.osekai`: 1 passed.

## Timing

- **App:** `output_main` `cpuMs` was about 2 ms at 60 fps (`production_v1`). `gpuMs` is unknown, because the frame acknowledgment reports null.
- **OBS:** `activeFps` was 60, with 0 output frames skipped in the QA scene. The render-skipped counter is cumulative for the OBS session, so it is not attributed to this run.
- Preview frame time is unknown, because it was not measured.

## Not checked

- WebGL 2 fallback, Windows, and continued motion with the editor minimized.
- Chroma key and depth of field. These features do not exist yet (CAM-13, MED-05, CAM-07).
