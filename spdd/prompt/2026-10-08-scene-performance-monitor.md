# REASONS: Scene performance monitor

Date: 2026-10-08. Scope: Scene preview diagnostics.

## R — Requirements

R1. Add a clear, accessible control in the Scene toolbar to show or hide a stats.js overlay.
R2. Show completed preview FPS and preview submission time. Keep stats.js panel switching available.
R3. Keep the monitor out of the transparent OBS output and all captures.
R4. Remember the local toggle state. Start with the monitor hidden when no preference exists.
R5. Stop measuring when hidden or after Scene teardown.

## E — Entities

`previewMonitor` is a Scene-window-local stats.js instance. A local storage key stores only its visible boolean. A two-method frame probe brackets one preview application.

## A — Approach

Mount stats.js inside the Scene viewport, outside the canvas. Pass an optional probe into desktop bootstrap and call it from the preview pump around `applyFrame`. Gate probe calls by current visibility. Keep the output renderer and session worker unchanged.

## S — Structure

Change the Scene Svelte component, its viewport styling, and desktop bootstrap. Add stats.js to the desktop package and its TypeScript types as a development dependency.

## O — Operations

1. Add package dependencies and Scene toggle/overlay.
2. Bracket preview submission, including rejection, with balanced probe calls.
3. Check TypeScript, build, focused tests, and the running macOS Scene. Verify clean OBS output.
4. Record the bounded parity claim and evidence.

## N — Norms

Use pnpm and `@oshi-connect/ui` for the toolbar control. Keep visual style compact and consistent with existing Scene controls. Use no Tauri IPC for monitor samples.

## S — Safeguards

Do not claim GPU, system memory, or OBS throughput measurements. Do not add a second render loop. Ensure an exception from rendering leaves stats.js timing balanced. Keep monitor DOM separate from the rendered canvas.
