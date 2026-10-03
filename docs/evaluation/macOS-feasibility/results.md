# macOS feasibility results

Date: 2026-10-03. Status: technical macOS smoke gates passed; clipboard UI acceptance pending. This document retains earlier failures. It does not approve the next concert slice.

## Scope

The fixture is smoke_v1: one VRM performer and glTF props. The host is Mac15,6, Apple M3 Pro, 36 GB RAM, with 12 CPU cores. macOS is 27.0.1, build 26A434. The host used AC power with low power mode disabled. OBS is 32.2.2; OBS WebSocket is 5.7.4. Output is 1920 by 1080 at a configured 60 FPS. This host does not establish the proposed M1 minimum or concert performance.

Pinned fixture asset records:

| Asset | Bytes | SHA-256 |
| --- | --- | --- |
| fixture_vrm_1 | 10776032 | 12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2 |
| fixture_glb_1 | 1320 | f7b2f45c6f516a8e6e74ed5c8c4f93de09dd558396b9b5faaf6be972b806586b |

## Acceptance state

| Requirement | Evidence | Result |
| --- | --- | --- |
| Packaged app outside checkout; VRM/glTF output | [First output](first-output.md) | Verified on this host |
| Editor edits and camera changes | [First output](first-output.md) | Partial; clipboard pending |
| All nine MCP tools and resource integrity | [Release round trip](mcp-roundtrip.md) | Verified; not a timing result |
| Three qualifying runs per supported backend | Timing records below | Passed on this host and smoke_v1; six runs below |
| Separate minimized recording | c5e107a: 40 decoded samples; 18 minimized samples advance | Verified at 2 FPS on WebGPU; not every encoded frame |
| Raw alpha and dark/light/checker review | Both backend smoke images and runtime reframing reviewed | Passed scoped review; minor default Wide shoe crop retained |
| Source hide/restart and recovery | c5e107a and 1073130 lifecycle v2; five 1073130 in-document reloads | Verified on WebGPU within 2 seconds |
| Ten-minute soak, five asset reloads | 1073130: 600002 ms, five correlated visible reloads | Passed sampled smoke checks; GPU reclamation unknown |
| Final model review packet | Stable final-model-review.json, rubric 1 | Scoped technical smoke verified; clipboard pending |
| GPU timing | No valid GPU timer | Unknown |
| Minimum hardware and concert target | No qualifying evidence | Unknown |

## Timing failures

Each formal run used 30 seconds of warmup and 120 seconds of measurement. The measurement contained 30 seconds visible, 45 seconds minimized, and 45 seconds restored. Window action offsets are relative to benchmark start. All screenshots and diagnostic captures occurred outside measurement.

| Run / source | Minimize / restore offsets | CPU p95 | Maximum interval | OBS render skips | Result |
| --- | --- | --- | --- | --- | --- |
| 05c0e0cc / 75de982 | 60002 / 105001 ms | 4.2 ms | 122 ms | 0 / 7229 | Fail: interval exceeds 100 ms |
| 9338c8b1 / 953ab9b | 60001 / 105001 ms | 3.9 ms | 121 ms | 0 / 7228 | Fail: interval exceeds 100 ms |

Both runs had interval p95 of 111 ms and no stale output periods. Capture identities and dark/light/checker marker correlation passed. Those checks do not prove visual alpha quality or minimized recording continuity. Earlier WebGPU and WebGL2 timing runs did not preserve the required minimized/restored phases. They remain preliminary and do not count as qualifying repeats.

The WebView background policy did not correct the worker timer slowdown. A separate diagnostic showed about 55 publisher sequence increments per second while visible and 9–10 while minimized. Ticks still followed elapsed time. A bounded WebSocket wake experiment kept 56–59 sequence increments per second while minimized. The spec now requires native wakeups with one outstanding pulse. JavaScript retains scene authority. The reviewed native clock correction is implemented at c5e107a. The qualifying native-clock timing results below now pass on this host; full feasibility acceptance remains pending.

## Qualifying native-clock timing

Source c5e107a4028f65b2e622384450f379363ba43d29 passed three runs per backend on this host and smoke_v1. Each used 30 seconds warmup plus 120 seconds measurement, with the prescribed visible/minimized/restored actions. The table records actual issued offsets; the indexed window-transitions.json files retain actual issued and completed timestamps. Action completion took 793–1306 ms and is not treated as instantaneous.

| Backend / run | Issued minimize / restore offsets | CPU p95 | Maximum interval | OBS render skips | OBS measurement delta |
| --- | --- | --- | --- | --- | --- |
| webgpu / d203303b | 60002 / 105002 ms | 3.3 ms | 39 ms | 0 / 7227 | 120449 ms |
| webgpu / 85a56557 | 60002 / 105001 ms | 3.2 ms | 30 ms | 0 / 7227 | 120450 ms |
| webgpu / 71551038 | 60002 / 105001 ms | 3.2 ms | 33 ms | 2 / 7229 | 120479 ms |
| webgl2 / 09aa701d | 60001 / 105001 ms | 3.2 ms | 28 ms | 0 / 7227 | 120445 ms |
| webgl2 / 01d181e1 | 60001 / 105001 ms | 3.0 ms | 28 ms | 0 / 7225 | 120417 ms |
| webgl2 / 8169ba14 | 60002 / 105002 ms | 3.1 ms | 28 ms | 0 / 7227 | 120450 ms |

All six runs passed CPU p95 <12 ms, maximum interval ≤100 ms, OBS render skips <0.1%, and native ACK freshness with no stale output periods. Native interval p95 was 19–20 ms. Sample counts were 7197 for d203303b and 7200 for the other five; no samples were truncated. GPU timing remains unknown. Resource warning counts were 14394 or 14400: two warning observations per accepted measurement ACK. The renderer reports unsupported VRMC_springBone and VRMC_node_constraint simulation on each frame, and the native accumulator sums frame.warnings.length. These totals are repeated observations of two known feature limitations, not distinct failures or proof of a leak. Spring-bone and node-constraint simulation remain unsupported. These timing results do not prove recording continuity, encoder behavior, source recovery, resource cleanup, final visual acceptance, or minimum hardware.

The native clock corrected the measured minimized stall: maximum intervals fell from 122/121 ms in the retained failed runs to 28–39 ms. WebGPU CPU p95 fell from 3.9 ms in the policy retest to 3.3/3.2/3.2 ms. Technical macOS smoke gates passed; clipboard UI acceptance remains pending.

## Source checks

At c5e107a, 180 JavaScript tests and 71 Rust tests passed. One licensed-fixture test was ignored in the standard Rust suite. Workspace type/Svelte checks and warning-free Clippy passed. These checks do not replace OBS acceptance.

## Evidence storage

[evidence-manifest.json](evidence-manifest.json) indexes local artifacts by relative path, size, and SHA-256. Large files remain in ignored artifacts/evaluation. Failed runs are retained. Connection descriptors, bearer URLs, and private asset paths are excluded.

The artifact index also retains the release MCP capture and cancelled summary, and the preliminary visual review report. The reviewer model label was supplied by orchestration context; no independent provider model ID was recorded. This preliminary report does not establish final visual acceptance.

## Recording and source lifecycle at c5e107a

The separate WebGPU recording is artifacts/evaluation/recording-1791033345460/output.mov: 14908585 bytes, SHA-256 c2d623ad5b6320eb798df817c0eae1f98ea253e2dbdde3f79c0f1a475c926430. Wall duration was 20.021 seconds; encoded duration was 19.8 seconds at 1920 by 1080 and 60 FPS. Minimize was issued at 5001 ms and completed at 6247 ms. Restore was issued at 15001 ms and completed at 15787 ms. OBS reported zero skipped encoder frames out of 1188.

The offline decoder sampled 40 frames at 2 FPS. All markers matched the session; sequence and tick advanced through all 18 interior minimized samples. The recording decoder uses documented lossy RGB bands. It does not change the strict production PNG decoder. This proves sampled continuity, not every encoded frame or an audio production path.

Lifecycle v1 retained a blank first OBS screenshot after a fresh native ACK. Native render submission alone did not prove composition recovery. Lifecycle v2, artifacts/evaluation/lifecycle-1791034480046, bound each OBS screenshot to a fresh registered capture and required visible alpha at least 80% of baseline. With hidden-source shutdown disabled, the source stayed connected and current visible output returned in 207.52 ms. With shutdown enabled, it disconnected, acquired a new renderer epoch, and current visible output returned in 520.01 ms. Both passed the 2-second gate and strict marker correlation. Capture IDs were f69fc79b-6c44-4945-9452-51202bcea43e and 9d6e6f1b-832a-46cf-b380-ce5bae71873e. Their bytes and hashes are indexed. This checks source hide/recreation on WebGPU, not in-document refresh.

## Framing and remaining reload checks

The reviewed default camera_wide preset at Y=1.2 crops the shoe soles in some motion phases. This is a minor framing defect, not missing geometry. The separate runtime Y=1.0 probe, artifacts/evaluation/framing-1791033009265, collected five fresh correlated native/OBS capture pairs. The visual reviewer observed full shoes and props with 76–93 pixels of lower margin. This runtime edit does not change the default preset. Full default-preset body framing remains limited.

The first ten-minute soak attempt, artifacts/evaluation/soak-1791033581777, stopped with TIMEOUT at its first scheduled refresh near 60 seconds. No refresh completed. The output page had removed its credential fragment; an in-document reload then had no descriptor. The validated private session cache correction is integrated at 1073130. Its 200 JavaScript unit tests, five integration tests and workspace checks passed. The later 1073130 refresh and ten-minute/five-reload soak passed; see the retained result below. The failed packet reports cleanup unknown and GPU reclamation unknown; it must not count as a completed soak.

Clipboard testing remains pending after automatic review rejected copying the bearer-bearing output URL. Explicit user authorization is still required. GPU timing, cross-epoch GPU memory reclamation, minimum hardware, Windows scheduling and concert acceptance remain unknown. No new-source acceptance follows from the older c5e107a evidence.

## Reload release checkpoint at 1073130

The 1073130f20b8fb2a648e3b7575ce169009eef56e release launched outside the checkout. Its retained framing packet, artifacts/evaluation/framing-1791035089035, contains five native/OBS capture pairs with matching current source identity and strict hashes/correlation. The separate lifecycle v2 packet, artifacts/evaluation/lifecycle-1791035123195, verified current visible recovery in 213.66 ms with shutdown disabled and 516.43 ms with shutdown enabled. Native ACK arrival was 11.77/339.86 ms. Registered capture IDs are e63ab80a-3c0e-4c12-9e96-08466e5d2548 and 04cdb10b-1c8a-4949-aa01-057ad5ca495c; the exact source manifests and hashes are indexed.

The corrected in-document refresh and ten-minute soak passed separately. This release's hide/recreate result alone would not pass those checks. Timing and recording results above remain identified with c5e107a; they were not rerun at 1073130.

## Completed reload soak at 1073130

The WebGPU soak, artifacts/evaluation/soak-v2-1791035156285/soak-report.json, ran for 600002 ms. Five full in-document refreshes each acquired a new renderer epoch and fresh correlated visible OBS output. Visual recovery was 503.95/479.88/503.80/486.52/498.37 ms; native ACK recovery was 318/318/317/317/321 ms. Each attempt preserved the strict session/camera/revision/tick and 500 ms capture correlation rules. All passed the separate 2-second recovery deadline.

The probe retained 120 diagnostic snapshots, 20 camera changes with ACK recovery 30–39 ms, and one cancelled benchmark, 967ac938-8625-4826-917f-139327ee3e95. OBS reported 0/36009 render skips; no stream or recording was active during the soak. Owned-scene cleanup completed. Sampled queues stayed within their bounds and the final snapshot had no queued frame/capture/state/control/pending work; ACK history was bounded at 32. Across sampled native snapshots, state/delivered maxima were 1/1, controls and pending calls/owners were zero, and ACK history was at most 32. Renderer queued frames/captures were zero across all 120 samples. Snapshots do not establish transient queue maxima.

Settled resource counts returned to 17 geometries, 27 textures, 24 live materials and two cached assets after reload. Some immediate new-epoch snapshots showed 16/26 before initialization settled. OBS main-process RSS changed from 1177200 to 1128224 KiB, a decrease of 48976 KiB. No memory budget is defined. CEF child processes and GPU allocations were not measured. These counts and the process trend do not prove old-epoch GPU memory reclamation; that result remains unknown.

The latest source check passed 200 JavaScript unit tests, five integration tests and workspace TypeScript/Svelte checks. Rust source was unchanged by the reload correction; the prior 71-test and warning-free Clippy result remains identified with c5e107a. One licensed-fixture Rust test was ignored in that standard suite. Clipboard UI acceptance remains pending; no concert analysis is created at this checkpoint.

## Final evidence review

The stable final-model-review.json packet identifies rubric 1 and prompt task-11-final-wide-webgpu-visual-review-v1. Its SHA-256 is 7238f3a6e03c84f08eab011903870b20f4b4358ae2175846c2cd1cc8e2ba24c1. The reviewer inspected real native/OBS images, sampled recording frames, lifecycle packets and 17 completed-soak images with hashes and markers checked. The orchestration model label is gpt-6.1-sol with low effort; an independent provider model identifier was not exposed. No provider upload is claimed. The conditional verdict supports the technical smoke gates within the stated sources, fixture and backends. Clipboard UI acceptance remains pending. The default Wide shoe crop remains minor; GPU timing/reclamation, minimum hardware and concert performance remain unknown.
