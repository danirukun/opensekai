# SPDD analysis: macOS feasibility

Date: 2026-10-02. The user approved the architecture direction and requested an implementation plan.

## Purpose

Prove the initial production path before building broad parity. A Tauri app must own one session. A separate OBS Browser Source must display that session with transparent output. MCP must inspect and change the same session and return labeled evidence.

The slice is an operational prototype. It is not a concert-performance acceptance build.

## Available environment

The repository contains documentation and two local checkpoints. No source code exists. The development host has macOS 27.0.1, an M3 Pro, and 36 GB memory. OBS 32.2.2 is configured for 1920 × 1080 at 60 FPS. Its local WebSocket server is reachable on port 4455 without authentication.

Observed tools: Node 26.10.0, pnpm 12.8.1, Rust/Cargo 1.93.1. The shared Svelte UI checkout has built dist files. Its package uses the GitHub Packages registry. A local snapshot adapter is needed for worktrees; credentials and a private package registry must not be required by the prototype.

## Scope

Build a small scene with a glTF/GLB or procedural reference object, one VRM performer, and two cameras. Use deterministic motion for evidence. Disable avatar spring physics in this slice. Full rig evaluation belongs to the concert foundation and tracking slices.

Implement the command and stream boundary, a bitECS candidate adapter, worker scheduling, native loopback service, prepared asset registration, renderer capabilities, simple scene UI, MCP, bounded captures, and a fixed smoke benchmark preset.

Use an opaque descriptor for local connections. Keep role-specific capabilities. Do not allow an OBS renderer to mutate the scene.

## Failure questions

Can WKWebView and OBS initialize the selected renderer and MToon material? Does motion continue while the app is minimized? Can clients reconnect to current state? Can a scene edit be verified in actual OBS output? Can a model obtain useful evidence through MCP?

Test these questions separately. A failure changes the relevant boundary. It must not become a fake success from static output or idle OBS metrics.

## Execution split

Build tooling and shared contracts first. Then use three parallel implementation lanes for session, native service, and renderer. After a first integration checkpoint, use three lanes for editor, MCP, and evaluation. The integrator owns shared files, dependency versions, lockfiles, and final platform checks.

Lower effort is appropriate for bounded lane tasks. Keep interface changes, architecture decisions, and final evidence review with the integrator.

## Follow-up scope

The next plan freezes the real concert hall with two performers and evaluates rig simulation, shadows, beams, screens, scene scale, and the proposed M1 minimum. Separate plans then add VMC/iFacialMocap, show persistence/undo, graph editing, sandbox delivery, exports, advanced shaders, and Windows acceptance.
