# OpenSekai smoke evaluation rubric v1

This rubric applies to smoke_v1 and the named WebGPU or WebGL2 profile. It does not establish concert or minimum-hardware acceptance.

## Evidence identity

Use the registered app capture ID and its canonical `opensekai://evidence/<id>/capture.png` resource. Record the matching native benchmark summary ID and `summary.json` URI. Check session, fixture, profile, revision, camera, backend, bytes and SHA-256. Keep asset bytes and connection tickets out of reports. OBS PNG files use their SHA-256 as file names. Native resource copies use opaque IDs. The CLI prints reports and hashes; it does not print descriptor paths, credentials, output URLs or PNG base64.

The source marker contains five unsigned 32-bit words: session tag, sequence, tick, revision and camera tag. Its header has eight alternating white/black cells. Each cell is 2 × 8 opaque physical pixels. Decode the actual source PNG. A malformed marker, wrong session/camera/revision, earlier tick, more than 30 later ticks, or a capture round trip over 500 ms fails correlation. Hash the UTF-8 IDs with the shared tagId function. Do not replace marker pixels with annotations.

## Deterministic gates

| Check | Rule |
| --- | --- |
| PNG budget | At most 2 MiB; positive dimensions at most 1920 × 1080 |
| Measurement | 30-second native warmup, then 120 seconds of native measurement |
| OBS render skips | Fewer than 0.1% skipped frames in the measured counter delta |
| Counter reset | Unknown result; never use a negative percentage |
| Render CPU | Native ACK CPU p95 below 12 ms, when measured |
| GPU | Unknown when the timer has no valid measurement; never substitute zero |
| Maximum stall | Native intervalMs.max at most 100 ms; unknown when absent or invalid |
| Tick progression | Actual source marker sequence and tick advance between labeled captures |
| Minimized continuity | Separate real OBS recording/decoded-frame evidence; this CLI does not record |
| Recovery | Current state returns within two seconds in a separate real reload check |

No screenshots or readback occur in the measured window. The driver samples OBS stats after native warmup and after measurement. Report the actual OBS counter interval. If this interval differs from the fixed window, mark the time gate unknown. Keep app CPU/interval metrics separate from OBS render/output counters. Output counters without a recording or stream are not encoder acceptance.

## OBS ownership and captures

The adapter requires advertised OBS requests and successful identification. Setup requires idle streaming and recording state. It does not start a recording. It creates unique scenes and inputs, restores the previous program scene in `finally`, removes only resources that it created, and reports incomplete cleanup. It does not modify a pre-existing source. Use a local endpoint without credentials in the URL.

The owned browser source is configured for 1920 × 1080 at 60 FPS, with hidden-source shutdown disabled. The raw scene name is returned as OwnedObsScene.sceneName. Its three composition scenes append `_dark`, `_light` and `_checker`. Each composition has an owned PNG background and the same browser source. The driver collects these after timing. A captured marker proves collection and identity; it does not prove correct visual alpha.

## Visual review

Inspect the real raw source and the three compositions. Check silhouette, face/eyes, hair, clothing, outline, texture detail, edges, background alpha and clipping. Record each defect with:

- App capture ID, OBS PNG hash, source/composition, backend and profile.
- Session, camera, revision and both marker ticks.
- Pixel location or bounding box and a reproducible operation.
- Expected appearance, observed appearance and severity.
- Whether it is an intended approximation or a defect.

Spring simulation, VRM constraints, local animation and full Unity shaders are outside this slice. Do not report their absence as a newly implemented feature. An entirely untextured white avatar is not an intended fixture appearance.

When a model client performs review, record model and prompt versions and the rubric version. No provider SDK, upload or automatic model review is included. Mark model review pending until it occurs.

## Local CLI

Set OPENSEKAI_CONNECTION_FILE to an operator descriptor and OPENSEKAI_RENDERER_CONNECTION_FILE to a renderer descriptor for the same session. Set OPENSEKAI_EVIDENCE_DIR and OPENSEKAI_PROFILE (`webgpu_smoke_v1` or `webgl2_smoke_v1`). OPENSEKAI_OBS_URL defaults to the local development endpoint. Run `pnpm evaluate:smoke --repeats 3` for three separate runs of one profile. Use `--repeats 1` for a scoped smoke run. The integrator owns live OBS execution. Unit tests use mocked OBS and a fake clock.

Store large evidence under ignored artifacts. Commit only reviewed metadata and sanitized summaries. A prepared source, a mocked test, or an app preview does not prove OBS acceptance.

## Review safeguards

Before PNG decoding, walk the bounded chunk envelope. Require exactly one first IHDR of length 13, dimensions within the image budget, and interlace method 0. Require bounded chunk lengths and a zero-length terminal IEND at the exact end. Reject duplicate IHDR chunks before the codec can replace dimensions or interlace mode.

Bind benchmark evidence to the requested run. Use exactly `opensekai://evidence/<run.id>/summary.json`, with an opaque ID of at most 128 ASCII letters, digits, underscores or hyphens. The manifest ID and parsed summary.run.id must equal that run ID. Check session metadata when supplied, and require the expected fixture/profile. A same-session summary for another run is invalid.

Compare each composition marker with current native output state for camera, revision, tick and a 500 ms observation round trip. A mismatch fails. AppStatus has no native receive timestamp, so matching metadata remains unknown for freshness. Do not add captures to the timing window or infer freshness from a session tag. Actual OBS checks can supply separate freshness evidence.

## Task 11 driver refinements

Use `--profile webgpu_smoke_v1` or `--profile webgl2_smoke_v1`, and `--repeats 1` or `--repeats 3`, in either order. OPENSEKAI_PROFILE remains an explicit alternative. CLI and environment profiles must agree when both are supplied. Reject duplicate flags, unknown fields, missing values and invalid profiles/repeat counts before descriptor or OBS access.

Use finite nonnegative native intervalMs.max for the stall gate: at most 100 ms passes; greater than 100 ms fails. Missing or invalid maximum interval remains unknown. Keep OBS stats response timestamp delta separate from the fixed native 30-second warmup and 120-second measurement policy. An OBS interval shorter than 120 seconds remains unknown; do not widen a threshold to report a pass.
