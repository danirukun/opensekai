# Local macOS and OBS baseline

Observed: 2026-10-02. Purpose: record development readiness before implementation.

## Host

| Field | Observed value |
| --- | --- |
| Machine | MacBook Pro |
| Chip | Apple M3 Pro |
| CPU | 12 cores |
| GPU | 18 cores |
| Memory | 36 GB |
| OS | macOS 27.0.1, build 26A434 |

Read through macOS version and hardware commands. Device serial numbers and hardware identifiers are excluded.

This host can support development and regression checks. It cannot establish the proposed M1-class minimum. The minimum tier still needs a measured concert run.

## OBS

| Field | Observed value |
| --- | --- |
| OBS Studio | 32.2.2 |
| OBS WebSocket | 5.7.4 |
| Endpoint | ws://127.0.0.1:4455 |
| Authentication | Not required in the observed Hello message |
| Negotiated RPC version | 1 |
| Base canvas | 1920 × 1080 |
| Output dimensions | 1920 × 1080 |
| Video rate | 60/1 FPS |
| Scene collection | OpenSekai, observed through the OBS window |
| Program scene | Scene |
| Source list | Empty in the observed OBS window |
| Streaming | Inactive |
| Recording | Inactive |

Inspection used the computer-use skill for the OBS window and a read-only WebSocket connection for Hello/Identify, GetVersion, GetVideoSettings, GetSceneList, GetStats, GetStreamStatus, and GetRecordStatus. Requests succeeded. No source, profile, output, or scene setting was changed.

GetVersion advertised screenshot, source/scene control, stats, and recording requests. Validate each operation against the active server when the adapter is built.

The idle status and cumulative frame counters describe the existing OBS session. They are not OpenSekai performance results. Future runs must compare counter differences over the measured window and verify actual moving output.

## First evaluation handoff

The next plan should create a controlled browser source for the first renderer and verify alpha at the observed 1080p60 settings. Add a bounded MCP inspection/edit/capture round trip and a minimized-editor motion check.

Use [the benchmark contract](benchmark-contract.md) for timing and [the MCP evaluation design](mcp-evaluation-design.md) for evidence. Record the selected backend and actual browser versions when app rendering exists.
