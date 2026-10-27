# Concert benchmark contract

Date: 2026-10-02. State: proposed acceptance details for implementation planning.

The agreed target is a representative 3D concert hall at 1920 × 1080 and 60 FPS, with one or two performers. The numerical thresholds below are proposals. Freeze them and the fixture manifest before using the benchmark for acceptance.

## Hardware tiers

| Tier | Purpose | Status |
| --- | --- | --- |
| Apple M1 class, 16 GB memory | Proposed macOS minimum for balanced concert output | Not validated |
| Apple M3 Pro, 36 GB memory | Current development and regression host | Available; not minimum-tier proof |
| Mid-range discrete Windows GPU, 16 GB system memory | Proposed Windows target | Exact GPU and host required before testing |
| Mobile | Future feasibility | No performance promise |

Suggest the M1 tier initially, then publish a measured minimum. Lower-quality and 30 FPS modes can extend reach. They do not pass the 1080p60 concert target. `benchmarkStart` fails with `INVALID_INPUT` and `output_main` (`Benchmark needs the default output format`) when the latest published scene has an `output_main` that is not 1920 × 1080, 60 FPS, and render scale 1 (B22), because such a run is not comparable.

Record the exact OS, CPU/GPU, memory, power mode, display layout, app commit, dependency versions, renderer backend, browser/webview, OBS version, and encoder. Test a release build outside debugger overhead. Keep debug results labeled.

## Fixture contract

A smoke scene proves startup only. Acceptance requires a frozen hall manifest with:

- Source licenses and hashes, importer versions, prepared package versions, and texture sizes.
- Triangle count, material count, visible draw calls, mesh count, and total scene entities.
- Two representative VRM performers; repeat with one.
- Animated body and face samples, expressions, hair/spring-bone settings, and collisions.
- Static hall geometry, repeated seating/props, stage lighting, shadow settings, beam effects, particles, and at least one video screen.
- Wide, stage, and close-up cameras with a fixed cut and movement schedule.
- Fixed tracking replay, event sequence, random seed, and media playback position.
- A versioned quality profile with explicit shadows, resolution scale, effects, LOD, and preview rate.

No fixed draw-call or triangle promise exists yet. Define the manifest from a representative artist scene during the concert slice. Store shareable fixture metadata in Git. Keep private assets in fixtures/local/ and record hashes without private paths.

Create named WebGPU and WebGL 2 profiles. If the fallback reduces features, show the difference in the capability report. Compare like-for-like content when measuring backend cost.

## Run matrix

Run each supported backend and quality profile separately.

| Run | What it resolves |
| --- | --- |
| OBS Browser Source active; preview low-rate or off | Production output cost |
| OBS plus full editor preview | Cost of duplicate rendering |
| Editor minimized or occluded | Session scheduling and continued motion |
| One performer, then two | Animation and rig scaling |
| Wide, stage, close-up, repeated cuts | Draw/overdraw and allocation spikes |
| Source hidden then restored | OBS source lifetime and recovery |
| Renderer reload and connection interruption | Snapshot recovery and stale state |
| App source loss and malformed tracking packets | Bounded recovery |
| 30-minute session with edits and asset reloads | Memory, queues, and stability |

For steady tests, warm up for 30 seconds and measure at least 120 seconds. Repeat three times with the same manifest and schedule. Compare with an idle OBS baseline from the same session.

## Proposed quantitative gates

| Metric | Proposed threshold | Measurement |
| --- | --- | --- |
| Production render budget | p95 measured GPU duration below 16.67 ms when available | GPU timer; report unsupported measurement |
| Main render-thread work | p95 CPU work below 12 ms | App instrumentation; excludes waiting for next frame |
| Output continuity | Fewer than 0.1% OBS render-skipped frames during measured window | Difference in GetStats counters |
| State freshness | p95 normalized-sample receipt to render application below 50 ms | Correlated source/sample sequence; calibrated clocks |
| Long-session memory | No continuing growth after warmup under repeatable load | Sampled process/browser memory and resource counts |
| Recovery | Renderer rejoins within 2 seconds after connectivity returns | First current snapshot applied and displayed |

These checks are necessary but not sufficient for smooth output. Capture frame interval percentiles, maximum stall, consecutive repeated/late frames, and visible hitches. Require no repeatable stall over 100 ms during steady playback or camera cuts. Explain any excluded loading period.

OBS render-skipped counters alone cannot detect a browser that supplies the same texture repeatedly. Add a diagnostic sequence/tick marker to controlled output or correlate capture frames with renderer sequence reports. Prove displayed motion progresses while the editor is minimized. Remove diagnostic markers from normal production output.

Use a local recording to test encoding as a separate stage. Report encoder settings and output-skipped counter differences. Encoding loss is not the same as scene rendering loss. Do not start live streaming for a benchmark.

Clock values from different processes are not directly comparable. Define offset estimation or use round-trip measurements. First release measurements cannot claim camera-to-display latency unless the external capture time is known.

## Transparency and visual checks

Capture the actual OBS source over dark, light, and checker backgrounds. Check hair, outline, transparent surfaces, bloom, beams, particles, and camera backgrounds. Capture both raw source alpha and composited output when possible.

Inspect skin, eyes, expressions, deformation, materials, lighting, video playback, clipping, and camera continuity. Match camera, tick, fixture, profile, and scene revision between references. Record intended approximation differences.

[OBS Browser Source](https://obsproject.com/kb/browser-source) has its own frame rate and source lifetime settings. Record them. A hidden-source shutdown or reload is a configured lifecycle event, not a random renderer failure.

## Evidence packet

Each run produces a manifest, summary metrics, time series, structured warnings, labeled images, and a short local recording when needed. Store large files under artifacts/evaluation/<run-id>/. Commit the small summary and hashes. Include app commit, fixture version, backend, profile, and OBS configuration.

A screenshot of the app preview cannot establish OBS alpha or frame delivery. A static screenshot cannot establish animation or timing. A frontier model can identify visual defects; it cannot replace measured performance.

## Current evidence

There is no OpenSekai performance result. [The local baseline](2026-10-02-local-baseline.md) records hardware and OBS readiness only.
