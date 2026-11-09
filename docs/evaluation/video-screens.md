# Video screens check

Date: 2026-11-08. Scope: MED-02 slice 1, bundle B29 ([#60](https://github.com/danirukun/opensekai/issues/60)). Contract: [video screens](../../spdd/prompt/2026-11-08-video-screens.md). Branch: `claude/b29-video-screens-impl`.

Platform: Linux cloud container (Ubuntu, x86_64, no GPU, no OBS). Playwright Chromium (headless) from `/opt/pw-browsers`. Setup `gpu:` line: WebGPU on SwiftShader (device true), WebGL 2 on ANGLE Mesa llvmpipe. Test media: `fixtures/video/` (made by `scripts/make-test-videos.sh`, ffmpeg 6.1.1).

This check proves the host container parser, the record and serve rules, the session clock and control operation, the renderer load, sync, codec failure, and alpha rules on the software adapter, the Editor flow in headless Chromium, and MCP. It does not prove the Editor window (WebKit), the OBS Browser Source (CEF), OBS audio, visual quality or decode cost on a real GPU, or Windows.

## Host (Rust, verified)

- `assets::video` (17 tests): each test file against `fixtures/video/expected.json` (size, the turned 36 × 64 size, duration within 17 ms, codecs, alpha); each prefix of each file fails without a panic; the R4 failure list (`qt  ` brand, missing and second `moov`, zero and all-ones duration, external `dref`, `mp4v`, `vp09`, and `encv` entries, AC-3, mirrored and scaled matrix, coded size 5000 under a 64 × 36 `tkhd`, no video track, `matroska` DocType, `Cluster` before `Tracks`, no `Duration`, `ContentEncodings`, `A_AC3`, `V_MPEG4`, sizes above 4096).
- `registry` (4 tests): `stage_video`, deduplication, the name `Video`, library reload of `.mp4` and `.webm`, the 256 MiB limit on a sparse file and during the copy, and the serve checks (another codec, audio codec, size, or duration, WebM bytes under an MP4 record, a changed file).
- `import_integration`: the real service imports `h264-aac.mp4` and `vp9-opus.webm`, and `GET /assets/{id}` with a `Range` header answers 200 with `video/mp4` or `video/webm`, `nosniff`, no `accept-ranges` or `content-range`, and the full bytes. The records reload after a restart.
- The exact window permission list has `allow-import-video`. Shared record vectors (`fixtures/protocol/video-records.json`), the `video` summary kind, 4 video screens, both operations, and the frame field: `crates/contracts/tests/video_screen.rs`.

## TypeScript (verified)

- Contracts: the same record vectors, the summary kind, the limits, the operations, and `screenPlayback`.
- Session (19 tests): play, pause, restart, frame positions, new entries (asset change, content change, `createEntity`, `replaceScene`), no change on Auto Play, Loop, and Volume, removal, a control-only patch at an old revision (no revision change), a mixed patch that creates and plays, a mixed patch with a bad control operation (no commit), the fifth video screen by each path, and no `screenPlayback` field without a video screen.
- MCP (`video-screen.integration.test.ts`, real stdio process and session): the descriptions, `asset_list` with a video, create and play in one patch (revision 1), pause with a control-only patch at revision 0 (revision stays 1).
- Renderer (18 tests): `readVideoInfo` against `expected.json`, the R14 target and seek decisions, the R15 messages, the retry cap, the R16 audio flag for each instance, and the bitmap upload.

## Renderer on the software adapter

Raw output: [headless-check.txt](video-screens/headless-check.txt) (88 pass, 0 fail, 3 unknown), [spike-check.txt](video-screens/spike-check.txt).

| Check | WebGL 2 (llvmpipe) | WebGPU (SwiftShader) |
| --- | --- | --- |
| Spike: `VideoTexture` upright, colors, alpha | Go | No-go (Dawn rejects the copy); `ImageBitmap` upload: go |
| `vp9-opus.webm` and `h264-aac.mp4` at 250, 750, 1250, 1750 ms (red, green, blue, white) | Pass | Pass |
| 2250 ms: red with Loop, white without Loop | Pass | Pass |
| A paused entry keeps its color for 1 s of frames | Pass | Pass |
| A playing entry follows the session position; it plays again after `pauseVideos` | Pass | Pass |
| `hevc.mp4`: `Asset load failed: Video codec not supported: HEVC`; the VP9 screen draws | Pass | Pass |
| `vp9-alpha.webm` alpha 0 and 255 (within 2/255), screenshot PNG, direct and FXAA | Pass | Pass |
| `vp9-alpha.webm` alpha on the page canvas, direct and FXAA | Pass | Unknown (the page capture is one flat color) |
| OBS-page instance with `--autoplay-policy=no-user-gesture-required` plays unmuted | Pass | Not run |
| `Video playback blocked` when the policy blocks `play()` | Unknown (the harness gives a user gesture) | Unknown |

The playing checks allow 600 ms of lag (the 250 ms limit plus one seek on the software decoder). The paused checks are the exact position checks. Headless Chromium has an H.264 decoder in this run.

## Editor (headless Chromium, verified)

Raw output: [editor-check.txt](video-screens/editor-check.txt) (30/30). It covers Content before the source field, the Image and Video selects (R20), the start values, the import, cancel, and error paths, Auto Play, Loop, and Volume, Play, Pause, and Restart with the label from `screenPlayback` (also with the Preview off), `Missing video`, Open, the video screen limit for Content and Duplicate, the Content reset, and the Assets list text. The Add menu Screen item still makes image content.

## Codec support table

| File | Linux headless Chromium | Editor window (WebKit, macOS 27.2, M3 Pro) | OBS 33.0.1 (CEF, macOS 27.2) |
| --- | --- | --- | --- |
| `h264-aac.mp4`, `h264-late-moov.mp4`, `h264-turned.mp4` | Plays | Plays | Plays |
| `hevc.mp4` | `Video codec not supported: HEVC` | Plays | Plays |
| `av1.mp4` | Not drawn in the headless check | `Video codec not supported: AV1` | Plays |
| `av1.webm` | Not drawn in the headless check | `Video codec not supported: AV1` after the 10 s limit | Plays |
| `vp8.webm` | Not drawn in the headless check | Plays | Plays |
| `vp9-opus.webm` | Plays | Plays | Plays |
| `vp9-alpha.webm` | Plays | Plays, opaque (no alpha) | Plays, with alpha |

For `av1.webm`, macOS WebKit answers `decodingInfo` `supported: true` and `canPlayType` `probably`. The element reads the metadata, decodes no frame, and sends no `error` event. At commit `9700b1f` this gave `Video failed to load`. Now a timeout after the metadata gives the codec message (implementation record, R15). The running Editor showed `Asset load failed: Video codec not supported: AV1` on `preview_main` about 10 s after the screen was made, and H.264 and VP9 on the same screen loaded with no warning.

## macOS local QA (PR #264)

Commit `9700b1f`, macOS 27.2, Apple M3 Pro, OBS 33.0.1, WebGPU in the Editor preview and in the OBS page, the dev binary with `OPENSEKAI_EVALUATION=1`. These items passed: the Editor window plays a `blob:` URL; the import of all 9 files; OBS playback of all 9 files; the OBS page keeps playing while the Editor is minimized for 30 s; OBS audio with "Control audio via OBS" for `vp9-opus.webm` and `h264-aac.mp4`, and Volume 0.5 lowers the level by 6.0 dB; `vp9-alpha.webm` over a magenta OBS source shows the magenta in the transparent half; Play, Pause, Restart, Loop off, Save As, and Open; upright and unmirrored orientation and the nominal colors on a real GPU. Screen captures that show both views at one instant show the Editor about 46 to 73 ms ahead of the OBS preview. This number includes the OBS compositor and preview latency.

## Not proven

Sync between the OBS page and the preview within one frame (the macOS measurement includes the OBS preview latency), Editor window silence (no listening check), decode cost on a real GPU, HEVC alpha, the benchmark subset (see the benchmark gate in the contract), and Windows. An old build does not open a show with a video screen.
