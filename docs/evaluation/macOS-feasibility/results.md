# macOS feasibility results

Date: 2026-10-03. Status: acceptance pending. This document records partial evidence and failures. It does not approve the next concert slice.

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
| Separate minimized recording | No final recording yet | Pending |
| Raw alpha and dark/light/checker review | Preliminary WebGPU review only | Final wide view and WebGL2 review pending |
| Source hide/restart and recovery | No complete lifecycle record yet | Pending |
| Ten-minute soak, five asset reloads | Probe prepared | Pending |
| Final model review packet | Preliminary review only | Pending |
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

All six runs passed CPU p95 <12 ms, maximum interval ≤100 ms, OBS render skips <0.1%, and native ACK freshness with no stale output periods. Native interval p95 was 19–20 ms. Sample counts were 7197 for d203303b and 7200 for the other five; no samples were truncated. GPU timing remains unknown. Resource warning counts were 14394 or 14400 and still require scope interpretation. These timing results do not prove recording continuity, encoder behavior, source recovery, resource cleanup, final visual acceptance, or minimum hardware.

The native clock corrected the measured minimized stall: maximum intervals fell from 122/121 ms in the retained failed runs to 28–39 ms. WebGPU CPU p95 fell from 3.9 ms in the policy retest to 3.3/3.2/3.2 ms. Full feasibility acceptance remains pending.

## Source checks

At c5e107a, 180 JavaScript tests and 71 Rust tests passed. One licensed-fixture test was ignored in the standard Rust suite. Workspace type/Svelte checks and warning-free Clippy passed. These checks do not replace OBS acceptance.

## Evidence storage

[evidence-manifest.json](evidence-manifest.json) indexes local artifacts by relative path, size, and SHA-256. Large files remain in ignored artifacts/evaluation. Failed runs are retained. Connection descriptors, bearer URLs, and private asset paths are excluded.

The artifact index also retains the release MCP capture and cancelled summary, and the preliminary visual review report. The reviewer model label was supplied by orchestration context; no independent provider model ID was recorded. This preliminary report does not establish final visual acceptance.
