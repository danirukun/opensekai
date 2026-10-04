# Rete Blueprint editor evidence

Date: 2026-10-04. Source commit: `ce70579`. Scope: BP-01 and BP-02 partial. Platform: macOS development host. Renderer backend: not applicable to the editor canvas; the existing scene renderer was not changed.

The editor has a Blueprints rail view with a Rete 2 canvas. It shows three connected draft nodes at first open. The palette adds six built-in node types. The inspector edits Number, Boolean, and Set Visibility settings. The panel validates a draft before calling the common `blueprintRun` edit command. The session worker executes the graph and commits its effects through the existing scene patch path. The graph stays in memory when the user switches editor panels.

Verification: `pnpm check` passed with zero Svelte errors or warnings. `pnpm --filter @opensekai/desktop build` passed. `pnpm test:unit` passed (404 tests); `pnpm test:integration` passed (9 tests); `cargo test --workspace` passed with one existing private-fixture test ignored. A browser check at the local editor URL showed the Rete canvas and typed connections. The browser check selected a node, added and deleted an Add node, edited a Boolean value, switched panels, and confirmed the value was retained. [Browser screenshot](rete-blueprint-editor-browser.png). The Rust loopback integration test sent `blueprintRun` to the publisher and checked its result.

Live Tauri check: The macOS development app showed the connected three-node Blueprint. The camera began visible; its Assets checkbox read `Hide Camera = 0`. I clicked that checkbox, and the control changed to `Show Camera = 1`. I then clicked Blueprints → Run in the Tauri window. The panel reported `Ran`. Back in Assets, the control read `Hide Camera = 0`: the graph restored the camera's visibility through the native session. [Tauri screenshot after Run](rete-blueprint-editor-tauri-ran.png).

Saved show graphs, a graph list, search, grouping, undo, and broader Warudo node coverage remain. BP-01 and BP-02 remain unchecked.
