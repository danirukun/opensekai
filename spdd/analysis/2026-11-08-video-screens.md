# Video screens analysis

Date: 2026-11-08. Scope: MED-02 slice 1 (video screens, playback, and codec diagnostics). Contract: [video screens](../prompt/2026-11-08-video-screens.md). Issue: [GitHub #60](https://github.com/danirukun/opensekai/issues/60). Base: B28 image screens ([contract](../prompt/2026-11-04-image-screens.md), merged in #258).

## Problem

An operator cannot show a video in the scene. A stream scene often has a looped background clip, a music video on a stage screen, or an intro clip. The [benchmark contract](../../docs/evaluation/benchmark-contract.md) asks for "at least one video screen" and a fixed "media playback position" in the concert scene. Today a screen shows only an image.

Warudo Screen (handbook, rechecked 2026-11-08): **Content Type** Video has a **Video Source**. "Major video formats are supported; transparent MP4 videos are also supported." **Auto Play** plays the video when the scene loads. The page gives no loop, volume, or playback control rules and no codec list.

## Code facts

- B28 made `screen` an entity kind with a `content` union. The union has one member, `{ kind: 'image', assetId }`. The schema comment says that B29 adds the video member.
- The image record path: `AssetRecord.format` has `png | jpeg | webp | gif` with the `image` group, an `image_` ID prefix, a 64 MiB file limit, `parse_image` at import and at serve, and the content type of the format at `GET /assets/{id}`.
- `read_located` reads the full file, checks the size and the SHA-256, then checks the header. It does this at each serve.
- `GET /assets/{id}` needs a bearer header. A `<video src>` cannot send a header. The renderer reads assets with `readAsset` (fetch with the header) into an `ArrayBuffer`. The service has no `Range` support.
- Each renderer instance gets `frame.elapsedMs` from the session. The MToon UV animation already uses it, so all instances agree on time and the motion continues when the editor is minimized.
- There are two renderer instances: the OBS page (`apps/output`) and `preview_main` in the Editor window (`bootstrap.ts`). The scene pane preview, the editor viewport, and `cameraScreenshot` all use `preview_main`. Each instance decodes its own assets.
- The session has runtime state that it does not save (tweens, debug log, tracking peaks). Each `scenePatch` commits and changes the revision today (`applyPatch` in `session.ts`). No operation changes only runtime state. `resolveCalibrations` already changes the operation list before the commit.
- The cloud container has ffmpeg 6.1.1 with libx264, libx265, libvpx (VP8, VP9), libaom and SVT-AV1, AAC, and Opus encoders.
- Headless Playwright Chromium 153 in the cloud answers `canPlayType` "probably" for H.264, AV1 (MP4 and WebM), VP8, VP9, AAC, and Opus, and "" for HEVC. So the cloud can prove a playable path and an unsupported-codec path.

## Decisions

- A video screen is a second member of the screen `content` union: `{ kind: 'video', assetId, autoPlay, loop, volume }`. The screen keeps its ID, transform, and Blueprint targets when the operator changes the content type.
- A video is a new asset kind (`video_` prefix) with the formats `mp4` and `webm`. The record keeps the file as the operator gave it. The host parses the container boxes or elements (not the frames) at import and at serve. It reads the display size, the duration, the video codec, the audio codec, and the WebM alpha flag. It rejects an MP4 with an external data reference. No new crate is necessary.
- The renderer reads the file with `readAsset`, as for models and images, and plays it from a `Blob` object URL. This keeps the bearer token out of URLs and needs no `Range` support. The cost is memory: the file is in memory once in each renderer page. So the file limit is 256 MiB, not more.
- The session owns playback. It keeps a runtime play state for each video screen and puts the playback position on each frame. Each renderer instance seeks its `<video>` element to that position when the drift is too large. So the OBS page, the preview, and a replay agree on the position, and the OBS page continues when the editor is minimized.
- Play, Pause, and Restart are one runtime operation in `scenePatch`. The session takes it out before the commit, so a patch with only this operation does not change the revision and does not need the current revision. Auto Play, Loop, and Volume are saved.
- Only the OBS page plays audio. `preview_main` is muted, so the operator does not hear the audio two times. OBS gets the audio with "Control audio via OBS" on the browser source.
- Codec diagnostics are per renderer instance. The renderer checks the full codec string with `MediaCapabilities.decodingInfo` and handles element errors. An instance that cannot decode the video reports `Video codec not supported: <codec>` as a frame warning. An OBS-only failure shows in `app_status` outputs and in the Assets list warnings. The record shows the codec in the Assets list. The cloud test proves the H.264, VP9, and AV1 path and the HEVC failure on Chromium. The owner records the WebKit (Editor window) and CEF (OBS) results on macOS.
- Transparency: a WebM with `AlphaMode` 1 (VP8 or VP9 with alpha) draws with the B28 alpha rules. An MP4 draws opaque in this slice. HEVC with alpha ("transparent MP4" in Warudo) needs a later slice.

## Effects

- Old shows open without change. A show with a video screen does not open in a build without this slice.
- The asset library gets video records. `assetList` gets the summary kind `video`.
- The frame gets an optional `screenPlayback` list. No renderer instance that does not know the field exists (the schema is strict on both sides and changes in one commit).
- Each playing video costs one decoder in each renderer instance that draws it: two in total.

## Risks

- WebKit and blob URLs: WKWebView plays a `<video>` from a `blob:` URL in current macOS, but the cloud cannot prove it. If it fails, the fallback is a `Range` endpoint with a short ticket. The owner checks this first.
- Codec support differs. WebKit plays HEVC and not WebM alpha. Chromium in the cloud does not play HEVC. The CEF build in OBS decides the OBS result. A video that plays in the Editor window can fail in OBS. The per-instance warning makes this visible, but the operator must choose a codec that OBS plays. The evaluation records a support table.
- Memory: during a load, each renderer instance holds the read chunks, the joined buffer, and the `Blob`, so the peak is about 3 times the file size. After the load, the `Blob` stays (1 time the file size in each instance), plus the decoder buffers. 4 videos of 256 MiB can use about 2 GiB after load in the two instances, with higher peaks during loads. The host also reads and hashes the full file at each serve. The contract limits video screens to 4 and caps the retries of a failed video load.
- Decode cost: each instance decodes each visible playing video. The contract adds a benchmark gate: a later benchmark slice adds the restart at start, the position in the manifest, and the decode cost metrics before the concert benchmark uses a video screen.
- Drift: the `<video>` clock and the session clock drift. A seek on drift above 250 ms can show a short stall. A drift of 0.1 % gives one seek in about 4 minutes.
- three.js `VideoTexture` uses another upload path on WebGPU than an image texture. Orientation, color, and alpha are not proven. The contract starts the renderer work with a spike and a fallback upload.
- A seek in a long-GOP file can be slow. The renderer shows the last decoded frame until the seek ends. It does not stop the other entities.
- Audio sync in OBS cannot be measured in the cloud.

## Out of scope

The benchmark subset (see the benchmark gate in the contract), HEVC alpha in MP4, MOV and Matroska files, a muted import of a file with an unsupported audio codec, live MediaRecorder WebM files without a duration, `Range` streaming, files above 256 MiB, Blueprint playback nodes and Blueprint video properties, seek to a position from the Inspector, playback rate, audio in the Editor window, an audio device choice, GIF and WebP animation (still B28 first frame), web pages (B30), capture (B31), MED-05 appearance fields, drag and drop, MCP import, and video import from a Warudo scene file.
