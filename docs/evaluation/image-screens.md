# Image screens check

Date: 2026-11-07. Scope: MED-01 slice 1, bundle B28 ([#59](https://github.com/danirukun/opensekai/issues/59)). Contract: [image screens](../../spdd/prompt/2026-11-04-image-screens.md). Base commit: 99ecae5 plus the B28 implementation branch changes.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS). pnpm 12.8.1, rustc 1.93.1, Playwright Chromium (headless) from `/opt/pw-browsers`. Setup `gpu:` line: WebGPU on SwiftShader (device true), WebGL 2 on ANGLE Mesa llvmpipe.

This check proves the host header parser, the record and serve rules, the session operation, the renderer load and draw rules, the alpha values in the output on WebGL 2, the camera screenshot path, the Editor flow, and MCP. It does not prove the Editor window on WebKit, the OBS Browser Source (CEF), visual quality on a real GPU, an animated GIF in a real file, or Windows.

## Host (Rust, verified)

| Check | Test | Result |
| --- | --- | --- |
| PNG, JPEG, WebP (`VP8 `, `VP8L`, `VP8X`), and GIF sizes from the header (R4) | `assets::image` `reads_each_type` | Pass |
| GIF frame count, the 4096 frame limit, no frame, and a frame larger than the screen (R4) | `counts_gif_frames_and_keeps_the_screen_size` | Pass |
| JPEG orientation 6 swaps the sides; 3 and an invalid value do not (R4) | `jpeg_orientation_swaps_the_sides` | Pass |
| An unknown signature, a GLB, and each prefix of each type fail without a panic (R4) | `rejects_unknown_and_truncated_files` | Pass |
| Bad IHDR, size 0, a side above 8192, an area above 33,554,432, a JPEG without SOF, a bad segment length, a WebP RIFF size mismatch, a bad VP8 start code, a GIF without a trailer, a sub-block outside the file, and an unknown block (R4) | `rejects_bad_headers` | Pass |
| Stage, deduplicate, library reload, the `.png` and `.gif` file names, the name `Image` for an empty stem, and no image in `fixture_records` (R2, R5) | `registry` `stages_an_image_deduplicates_and_reloads_it` | Pass |
| A file above 64 MiB and a GLB with a `.png` name fail with `INVALID_INPUT` (R5) | `image_import_rejects_large_and_unknown_files` | Pass |
| Serve: another image type under a PNG record, a size that differs from the record, and a changed file fail (R6) | `serving_an_image_checks_the_type_and_the_size_against_the_record` | Pass |
| Real service: import, deduplicate, `GET /assets/{id}` with `content-type: image/png` and `nosniff`, and the record after a restart (R5, R6) | `import_integration` `imported_image_is_served_with_its_content_type_and_survives_restart` | Pass |
| The exact window permission list has `allow-import-image` (R3) | `lib` permission list test | Pass |
| Save As and Open keep a screen whose image is not in the library (R22) | `show` `round_trip_keeps_a_screen_with_an_unknown_image` | Pass |
| Shared record vectors (`fixtures/protocol/image-records.json`), the `image` summary kind, 16 screens, and `setScreenImage` (R1, R2, R8, R9) | `crates/contracts/tests/screen.rs` | Pass |

## TypeScript (verified)

- Contracts: the same record vectors, the summary kind, the screen limit, `setScreenImage`, the property registry rows for a screen, and a Blueprint export and import of a screen reference (R1, R8 to R10).
- Session: create, share one image, clear, the wrong kind, an unknown entity, and the 17th screen (R8, R9).
- Renderer unit tests: the signature check, the header sizes with orientation, the alpha decision, the one `createImageBitmap` option set, the one failure message, the quad size, the material, and the UV rows; with a stand-in loader, one shared texture for two screens, no GLB load for a screen, its release when no screen uses it, and the frame warning `Asset load failed: Image failed to load` while the other screen draws (R11 to R14).
- Editor unit tests: the factory, `Screen 2`, the 16 and 64 limits, the Screens group after Props, the sections, the reset field, and the select lists (R17 to R20).
- MCP over real stdio: the descriptions, the `image` summary, `createEntity` with a screen, `setScreenImage`, the wrong kind, and a clear (R21).

## Output pixels (headless Chromium)

`image-screens/headless-check.mjs` runs the built OBS page with a stand-in host and a real session ([raw output](image-screens/headless-check.txt), [record](image-screens/headless-check.json)). The script makes each test image: a 64 × 32 PNG (left half opaque, blue top rows and red below; a green strip with alpha 128; the other columns alpha 0), a JPEG that Chromium encodes with an EXIF orientation 6 segment, and a WebP with alpha. The probes read the page capture without the page background.

| Case | WebGL 2 | WebGPU |
| --- | --- | --- |
| PNG, direct path: opaque 255, blue at the top (upright), alpha 0 in transparent parts and outside, the strip alpha 128 | Pass ([image](image-screens/png-direct-webgl2.png)) | Loads without a warning; pixels unknown (the capture is one flat color) |
| PNG with FXAA | Pass ([image](image-screens/png-fxaa-webgl2.png)) | Same |
| PNG with a visible haze entity in the scene (the post chain with haze) | Pass ([image](image-screens/png-haze-webgl2.png)) | Same |
| Back face: the image is mirrored | Pass ([image](image-screens/png-back-webgl2.png)) | Same |
| JPEG orientation 6: blue at the top, 0.5 m wide | Pass ([image](image-screens/jpeg-orientation-6-webgl2.png)) | Same |
| WebP with alpha | Pass ([image](image-screens/webp-webgl2.png)) | Same |

Result: 51 pass, 0 fail, 6 unknown. The haze box is outside the camera view, so this case proves the post chain path, not the look of a screen inside haze.

## Editor and camera screenshot (headless Chromium)

`image-screens/editor-check.mjs` runs the built Editor window with a stand-in host. Since the one-window change, the window runs the session worker as the publisher; the stand-in relays operator calls to it and frames to the preview renderer ([raw output](image-screens/editor-check.txt)). 18 of 18 pass:

- The Add menu has Screen after Prop; Add makes `Screen`, then `Screen 2` (R17). The Hierarchy shows Screens (R18).
- The Inspector has Transform and Screen; the Image select has `Choose image…`, the record, and `Import file…`. `Import file…` runs `import_image` once and sends one `setScreenImage` for that screen. The viewport reads the image over `GET /assets`, with no load failure. A chosen image has a reset mark, and the reset sends `null`. An ID that is not in the library shows `Missing image` (R19, R22). [Inspector](image-screens/inspector-screen.png), [missing image](image-screens/missing-image.png).
- The preview renderer answers a camera screenshot request. The 1920 × 1080 PNG has alpha 255 on the opaque part, 0 on the transparent part and outside, and 128 on the strip (R15). [Screenshot](image-screens/camera-screenshot.png).

- After six Opens (`sceneReplace`) with image resets and a removed screen in between, the preview answers a screenshot at the newest revision and draws the image ([screenshot](image-screens/after-open-screenshot.png)). This step was added after the owner QA on #258 saw both renderers stop after an Open. It also passes on the code before the image lease fix, so the cloud did not reproduce that freeze.

The viewport is WebGPU in this check, and its page capture is one flat color ([viewport](image-screens/editor-screen.png)), so the viewport pixels are unknown.

## Not verified here (owner on macOS)

The Editor window (WebKit) and the OBS page (CEF) with a PNG with alpha, a JPEG with EXIF orientation, a WebP with alpha, and an animated GIF (first frame); no halo or dark fringe on transparent edges over a colored OBS background; the gizmo; a Blueprint Set Asset Property transition on a screen; Save As and Open. An older build does not open a show with a screen (the scene schema rejects the `screen` kind).
