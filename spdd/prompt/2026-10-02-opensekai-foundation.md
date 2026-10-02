# REASONS: OpenSekai foundation contract

Date: 2026-10-02. State: design-level contract; implementation planning pending.

This master contract records the agreed direction. Create bounded slice contracts before generating code. The initial slice covers macOS feasibility and early MCP. Broader parity remains in [the checklist](../../docs/warudo-parity.md).

## R — Requirements

R1. Build an open-source 3D VTubing app, codename OpenSekai. Begin on macOS. Preserve Windows portability and a possible mobile path.

R2. Use Tauri v2 native services and Three.js web rendering. Start with WebGPURenderer/TSL and test the WebGL 2 fallback.

R3. First prove transparent OBS Browser Source output without continuous image transfer through Tauri IPC.

R4. Use one authoritative session for motion, animation, physics, and graphs. Prove continued output when the editor is minimized.

R5. Target a representative 1080p60 concert hall with one or two performers. Treat M1-class hardware as a proposed minimum until measured.

R6. Receive external VMC and iFacialMocap. Keep protocol decoders separate from normalized session data.

R7. Support VRM and glTF/GLB first. Keep Blender and Unity authoring possible through a common package format. Preserve source metadata and diagnose unsupported materials.

R8. Define JS/TS sandbox extension boundaries from the start. Deliver guest plugins after the isolation gate.

R9. Add a typed blueprint execution core before the full visual graph editor.

R10. Add a local MCP server in the first feasibility slice. It must help inspect, change, capture, replay, and evaluate the app through the common API.

R11. Use a familiar hierarchy, viewport, inspector, asset browser, and output workflow.

R12. Keep the parity checklist and evidence current. Defer NDI and full Unity shader support.

## E — Entities

Show, scene entity, prepared asset, material descriptor, performer, tracking source, normalized sample, session, output client, command, scene revision, simulation tick, graph, operation, plugin manifest, capability grant, benchmark run, capture, and evidence manifest.

Persistent IDs are independent of ECS IDs. Scene revision describes edits. Tick and stream sequence describe evaluated updates. Captures identify both.

## A — Approach

Use the architecture in [the design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md).

Native services supply sockets, asset files, and a loopback renderer/state endpoint. A renderer-independent session owns evaluation. OBS and the editor preview consume evaluated state. Use bounded batches and recover through snapshots.

Evaluate bitECS first; keep Koota as an alternative. A-Frame remains a fit comparison. Evaluate a dedicated worker for session placement and QuickJS for guest isolation. These are candidates, not proven choices.

MCP is a local adapter over common commands and queries. OBS WebSocket supports controlled evidence collection. Frontier models review visual evidence. Numeric acceptance remains deterministic.

## S — Structure

Logical modules: contracts, session, renderer, editor, native host, tracking, MCP, evaluation, extensions, and authoring/import tools.

Only platform adapters depend on native platform services. Public schemas do not carry mutable renderer objects or guest engine handles. The [workflow](../../docs/development-workflow.md) defines ownership for concurrent work.

Store requirements and strategic context in spdd/analysis/. Store slice REASONS contracts in spdd/prompt/. Store architecture in docs/superpowers/specs/ and implementation plans in docs/superpowers/plans/ when approved.

## O — Operations

O1. Review this design and write the bounded macOS feasibility slice and implementation plan.

O2. Establish versioned command/query, state-stream, asset, error, and capability contracts. Pin dependency versions and create focused logic tests.

O3. Prove Tauri launch, actual backend capabilities, a small VRM scene, transparent OBS delivery, and minimized-session behavior. Add MCP inspection and a bounded edit/capture round trip within this slice.

O4. Freeze a real concert fixture. Select ECS and session placement from measured results. Run solo/two-performer, backend, preview, camera-cut, and long-session checks.

O5. Implement tracking and useful editor persistence/control flows through slice contracts. Parallel work can start after shared contracts are stable.

O6. Extend animation, props, screens, show controls, and typed graphs. Then add the visual graph UI.

O7. Validate sandbox limits and recovery before delivering guest plugins. Add Blender/Unity authoring adapters and material conversion profiles.

O8. Expand parity and Windows evaluation. Investigate mobile in a later slice. Add release packaging and licensing decisions before distribution.

These operations define dependency direction. They are not per-agent implementation tasks.

## N — Norms

The copied [constitution](../../docs/constitution.md) is binding. Apply all sixteen principles where the feature touches them: restrained UI copy, plain layout, R2 storage adapter, Cloudflare email, focused tests, clear technical prose, grouped database metadata, transformed CDN images, shared Svelte UI, prescribed hosting, Cloudflare services, pnpm, WorkOS identity, schema-before-code deployment, running UI checks, and functional TypeScript.

The session's explicit test instruction adds unit tests for new function behavior. Integration tests need a real boundary and a stated reason. No static-copy tests are required.

Keep platform code behind adapters. Version public contracts and saved formats. Preserve original assets. Use separate worktrees for concurrent agents. The integrator owns shared schemas and lockfiles.

## S — Safeguards

- No performance acceptance from a smoke scene, average FPS alone, or a faster development host.
- No continuous image readback/encode/IPC production output path.
- No second authoritative physics/animation loop inside renderer clients.
- No claim of background scheduling without minimized-host evidence.
- No unchecked guest access to DOM, native commands, mutable engine objects, network, or files.
- No model score replacing numerical performance gates.
- No checked parity item without scoped platform/backend evidence.
- No silent material fallback, incompatible schema overwrite, or unbounded packet/event queue.
- No simultaneous commits in the same worktree.
- No public push, distribution, or live streaming as an incidental verification step.
- Load the ecosystem NDI skill before actual NDI/frame work.

Acceptance uses [the benchmark contract](../../docs/evaluation/benchmark-contract.md) and [the MCP evaluation design](../../docs/evaluation/mcp-evaluation-design.md). Revisit this contract when an experiment changes a boundary.
