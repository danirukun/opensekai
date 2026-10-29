# REASONS: Turn off the Scene preview

Date: 2026-10-28. Scope: a Scene toolbar control that stops and starts the preview rendering. Analysis: [preview off](../analysis/2026-10-28-preview-off.md).

## R — Requirements

R1. The Scene toolbar has a Preview toggle button. Its title and accessible name are **Turn off preview** or **Turn on preview**. It is on at each launch. The state is not saved in the show or in local storage.
R2. When the preview is off, the Scene window applies no preview frames. The session worker, the simulation, Blueprints, MCP edits, and `output_main` do not change.
R3. When the preview is off, the viewport keeps the last frame, dimmed, and takes no pointer input (gizmos, picking, navigation, context menu).
R4. When the preview comes back on, the pump applies the newest frame on the next display frame. The renderer, its assets, and the connection stay open while the preview is off, so nothing loads again.
R5. MCP `camera_screenshot` works while the preview is off. The pump applies frames until the screenshot completes or fails, then stops again. The screenshot image is the same as with the preview on.
R6. The pump does not start a second application while one is in progress, in all states. Off, on, and screenshot requests in any order end in the same state as the last request.

## E — Entities

- `PreviewPump`: `{ offer(frame), stop(), setEnabled(boolean), wake(): () => void }`. The pump applies frames when it is enabled or when one or more `wake` holds are open. `wake` returns a release function. A second call of the same release function does nothing.

## A — Approach

Extend the preview pump with an enabled flag and a count of wake holds. The display-frame callback applies the newest frame only when `enabled || holds > 0`. The screenshot handler in `bootstrap.ts` takes a hold for the time of the screenshot. The Scene component owns the toggle state and calls `setEnabled`. No host, contract, renderer, or MCP change.

## S — Structure

- `apps/desktop/src/preview-pump.ts` and `apps/desktop/test/preview-pump.test.ts`.
- `apps/desktop/src/bootstrap.ts`: return a `setPreviewEnabled` function; take a wake hold in the screenshot handler.
- `apps/desktop/src/App.svelte`: the toggle button and the dimmed, inert viewport.
- `ARCHITECTURE.md`: the preview pump line.

## O — Operations

1. Pump states with unit tests (R2, R4, R5, R6).
2. Bootstrap wiring and the screenshot hold.
3. Toolbar button and viewport state.
4. macOS check in the running build with the Bonnie scene: output and preview frame rate and CPU time with the preview on and off, `camera_screenshot` while off, OBS output while off, resume.
5. Evidence and ARCHITECTURE.md.

## N — Norms

Use `@oshi-connect/ui` `Button` and a lucide icon, as the other toolbar toggles do. No helper text. Functional TypeScript. Prose in ASD-STE100.

## S — Safeguards

- Do not add a second render loop or a timer. Keep the one `requestAnimationFrame` pump.
- Do not send a fake frame acknowledgement. `app_status` keeps the last real preview frame.
- Do not change `output_main`, the host queues, or the show format.
