# Avatar performance investigation

Date: 2026-10-09. Platform: macOS, Apple GPU (Metal 3). Commit base: `b6b53e5`.

## Report

The operator loaded `RemModel VRM0 (1).vrm` and the Scene performance monitor showed 15 FPS.

## Cause

The avatar did not cause the 15 FPS value. The Scene preview pump used `setInterval(…, 1000 / 15)`, and the monitor counts only preview submissions. The monitor therefore showed at most 15 FPS for every scene, with or without an avatar. The session clock is 60 Hz and the OBS output renders each published frame, so neither was capped.

## Avatar profile

The model is a VRM 0.x file of 75 MB:

- 10 meshes, 15 primitives, 104,737 vertices, and 92,459 triangles.
- 10 skins with 194 joints each, and 184 morph targets on 6 primitives (82 on the head).
- 11 MToon materials, 8 of them with world-space outlines. With outlines, the renderer makes 25 draw calls and 168,141 triangles.
- 24 PNG images, 5 at 4096 × 4096. The loader resizes them to 2048 (output) or 1024 (preview).

A local harness loaded the file through `createAssetLoader`, `createAvatarBinding`, and `createRenderer`. It used real `createSession` frames with the built-in idle animation. Each run measured 240–300 frames after 60 warm-up frames, at 1920 × 1080 with MSAA, on WebGPU.

| Engine | Path | Renderer CPU per frame (mean / p95) | GPU per frame (timestamp mean) | FPS (display-limited) |
| --- | --- | --- | --- | --- |
| Chrome | `applyFrame`, no avatar | 0.6 / 0.9 ms | — | 60 |
| Chrome | `applyFrame`, Rem | 2.1 / 3.5 ms | — | 60 |
| Chrome | bare render, Rem | 2.0 ms (pose 0.5 + submit 1.5) | 2.6 ms | 60 |
| Chrome | bare render, Rem, no outlines | 1.9 ms | 1.9 ms | 60 |
| Safari 27 | `applyFrame`, Rem | 2.6 / 4 ms | — | 59.4 |
| Safari 27 | bare render, Rem | 2.9 ms | 2.5 ms | 60 |

The outlines cost about 0.7 ms of GPU time. The session `advance` cost was below 0.3 ms. The avatar uses less than a quarter of a 60 Hz frame budget in both engines.

First load: Chrome took 1.0 s to fetch, parse, and compile pipelines. Safari took 10.9 s on a cold pipeline cache and 2.1 s on a warm cache. During this time the render queue is busy.

## Limits

These measurements come from Chrome and Safari, not from the packaged WKWebView. They do not measure OBS frame timing. Safari timers have 1 ms resolution. The GPU column uses WebGPU timestamp queries and is unknown for the `applyFrame` path.

## Change

The preview pump now uses display frames. It renders the newest frame and skips a display frame while a submission is in progress.
