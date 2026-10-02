# SPDD analysis: OpenSekai foundation

Date: 2026-10-02. State: design analysis for review.

## Problem

Warudo provides a broad 3D VTubing and show-production workflow. The team wants a portable open-source app built with web rendering and native desktop services. Past VCheki work exposed output cost from image readback, encoding, transport, and background behavior.

The key feasibility question is whether the complete macOS production path can deliver a representative two-performer concert at 1080p60 with transparent OBS output. A fast standalone scene is not sufficient evidence.

## Users and work

Performers receive motion from existing apps. Operators import artist scenes, assign body/face sources, set cameras, adjust the show, and send it to OBS. Artists use a mixture of Blender and Unity. Developers add JS/TS extensions and new asset formats.

The UI should be familiar to Blender, Unity, and OBS users. Users need direct scene controls, clear source assignment, reliable output, and recovery from disconnected sources or missing assets.

## Domain concepts

- Show: persistent scene, asset references, cameras, source assignments, and graph definitions.
- Session: live authoritative evaluation of the show.
- Performer: avatar instance with rig, expression, animation, and tracking state.
- Prepared asset: versioned runtime package with source provenance and capability diagnostics.
- Output: renderer client with a selected camera and quality profile.
- Operation: validated command or scheduled behavior shared by UI, graphs, and extensions.
- Evidence run: fixed fixture, configuration, measurements, and captures tied to a commit.

## Approach

Use Tauri v2/Rust for the desktop host and native protocol adapters. Use Three.js WebGPURenderer and TSL for web rendering. Render production frames within OBS Browser Source first. Transport state and assets rather than an image stream.

Separate the authoritative session from renderers and editor widgets. Evaluate a small JavaScript ECS for predictable hot updates. Define stable IDs, revisions, reconnect, and capability boundaries before independent implementations.

Include MCP from the first feasibility slice. Provide scene queries, controlled edits, captures, and benchmark evidence. Use frontier-model assessment for visual defects alongside measured performance gates.

## Scope split

The product requires several slice specs. First prove macOS output, background behavior, a VRM scene, and MCP. Then freeze the real concert workload and prove performance. Add tracking, editor workflows, show features, sandbox delivery, broad parity, and further platforms through later slices.

The maintained parity checklist carries long-term scope. It does not turn every handbook feature into a first-release requirement.

## Risks and selection gates

| Risk | Gate or response |
| --- | --- |
| WKWebView and OBS differ in GPU support | Probe actual runtimes and pin tested versions |
| App worker slows when minimized | Measure displayed motion; change session placement if it fails |
| Two render clients double GPU cost | Measure both; use lower-rate preview |
| Unity material appearance diverges | Preserve source metadata and expose capability gaps |
| ECS does not solve GPU bottlenecks | Measure draw calls, shadows, overdraw, and rig updates separately |
| Native/guest boundary leaks capabilities | Test denied access, quotas, cancellation, and cleanup |
| MCP sees stale or unrelated captures | Label output, revision, tick, fixture, and source |
| Agents collide on shared files | Stabilize contracts, separate worktrees, integrator ownership |
| Unbounded parity goal delays useful output | Small slices with measured acceptance and explicit roadmap |

## Success criteria

The first slice runs on this Mac and connects a current OpenSekai scene to transparent OBS output. MCP can inspect, apply a bounded edit, and retrieve evidence. Session behavior is checked with the editor minimized.

The concert slice uses a frozen representative hall with two performers and meets agreed benchmark thresholds on actual target hardware. Later feature claims cite platform-specific evidence.

Sources, decisions, and detailed requirements are in [the architecture](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md).
