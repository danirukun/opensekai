# macOS feasibility results

Date: 2026-10-03. Status: acceptance pending. This document records partial evidence and failures. It does not approve the next concert slice.

## Scope

The fixture is smoke_v1: one VRM performer and glTF props. The host is Mac15,6, Apple M3 Pro, 36 GB RAM, with 12 CPU cores. macOS is 27.0.1, build 26A434. The host used AC power with low power mode disabled. OBS is 32.2.2; OBS WebSocket is 5.7.4. Output is 1920 by 1080 at a configured 60 FPS. This host does not establish the proposed M1 minimum or concert performance.

## Acceptance state

| Requirement | Evidence | Result |
| --- | --- | --- |
| Packaged app outside checkout; VRM/glTF output | [First output](first-output.md) | Verified on this host |
| Editor edits and camera changes | [First output](first-output.md) | Partial; clipboard pending |
| All nine MCP tools and resource integrity | [Release round trip](mcp-roundtrip.md) | Verified; not a timing result |
| Three qualifying runs per supported backend | Timing records below | Pending; accurate minimized runs failed |
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

The WebView background policy did not correct the worker timer slowdown. A separate diagnostic showed about 55 publisher sequence increments per second while visible and 9–10 while minimized. Ticks still followed elapsed time. A bounded WebSocket wake experiment kept 56–59 sequence increments per second while minimized. The spec now requires native wakeups with one outstanding pulse. JavaScript retains scene authority. Implementation and real acceptance are pending.

## Source checks

At 953ab9b, 163 JavaScript tests and 66 Rust tests passed. One licensed-fixture test was ignored in the standard Rust suite. Workspace type/Svelte checks and warning-free Clippy passed. These checks do not replace OBS acceptance.

## Evidence storage

[evidence-manifest.json](evidence-manifest.json) indexes local artifacts by relative path, size, and SHA-256. Large files remain in ignored artifacts/evaluation. Failed runs are retained. Connection descriptors, bearer URLs, and private asset paths are excluded.
