# Blueprint Color type and kit color picker check (B38)

Checked 2026-11-20 on macOS 27.2.1 (arm64), Node 26.13.0, pnpm 12.8.1, Playwright 1.65.0 (headless Chromium). Branch: `claude/b38-color-type`. Base: `fd4fe09b` (`origin/main`). Commits: `1ed87574` (kit pin), `3d05360e` (type and nodes), `d562583b` (pickers). Kit: `49c63867a6bba5815ad5ed71a10580e945ad8fa4` (kit 0.2.0, with ColorPicker). Contract: [material parameter control, R7–R12 and R31](../../spdd/prompt/2026-11-16-material-parameter-control.md).

The desktop app was not started. The renderer backend, the quality profile, and OBS do not apply to these checks. The macOS WKWebView editor is not checked (`accept:local`).

## Automated checks

| Command | Base `fd4fe09b` | This branch | Notes |
| --- | --- | --- | --- |
| `pnpm check` | 0 errors | 0 errors, 0 warnings | |
| `pnpm test:unit` | 2732 passed, 1 skipped (286 files) | 2740 passed, 1 skipped (287 files), 0 failed | |
| `pnpm test:integration` | 118 passed, 7 skipped (46 files passed, 3 skipped) | 118 passed, 7 skipped (46 files passed, 3 skipped) | |
| `cargo test --workspace --no-fail-fast` | 625 passed, 1 failed, 2 ignored (61 suites) | 626 passed, 0 failed, 2 ignored (61 suites) | The base failure was the known `clock_integration` timing flake |
| `cargo clippy --workspace --all-targets` | 0 warnings | 0 warnings | |
| `cargo fmt --all -- --check` | 2 files differ | 2 files differ | `recent_shows.rs` and `tracking/parser.rs`, not changed here |

## What the tests cover

- Kit (R7): `docs/dependencies.md` names the kit commit above, and the snapshot comes from it.
- Value model (R8): `color` is a scalar type with the label Color and the default `#ffffff`. A value is a lowercase `#rrggbb` string. Uppercase, `#rgb`, and `#rrggbbaa` are rejected. Color does not connect to or from String. The zod schema and the fast check agree on a sample set. Color lists use the same rule for each item. The shared vector `fixtures/protocol/blueprint-variables.json` has a Color and a Color list variable and three rejected cases; the TypeScript and Rust contract tests read it.
- Nodes (R9): Color gives its setting. Make Color clamps each channel to 0–1, reads a non-finite channel as 0, and rounds to the nearest of 255 steps. Break Color gives byte / 255, and Make Color of the Break Color outputs gives the same color. The catalog has 194 entries.
- Editor text (R10): `parseScalar('color', …)` accepts `#rgb` and `#rrggbb`, with or without `#`, in any case, and gives the lowercase long form.
- Debug text, the string form, and Format String (R8): a color shows as its hex text.
- No migration (R12): the existing fixtures and tests still pass with `formatVersion: 1`, and the extension port types do not change.

## Headless editor check

`pnpm build`, then `pnpm exec tsx docs/evaluation/color-type/editor-check.mjs docs/evaluation/color-type`. Output: [editor-check.txt](color-type/editor-check.txt). Result: 22/22 passed.

- R10: the color socket has its own color (a conic gradient of the theme tokens).
- R10: the inline picker on the unconnected color input of Break Color, at zoom 1 and at zoom 0.48. At each zoom, the panel is inside the viewport, it is the element at its own center, and it is 15rem wide (the canvas does not scale it). A drag in the panel sends one `setNodeInput` with a new color, and the node does not move. Escape closes the panel.
- R10: a drag in the Value picker of a Color node sends one `setNodeSettings`.
- R10: `#336699` typed in a Color variable default sends one `updateVariable`.
- R11: on a new Point Light, a drag in the Inspector Color picker sends 9 live `setLight` patches and none after the pointer is released. The scene holds the shown color. A typed `#00ff00` sends one `setLight` patch.
- R11: the FPS Counter Color, the camera Grading Tint, and the camera Vignetting and Night Vision Color each open the kit picker inside the viewport.
- No page error. Headless Chromium logs WebGPU validation errors and a device loss from the preview renderer; they are console messages, not page errors, and the check does not count them.

Screenshots: [node picker at zoom 1](color-type/node-picker.png), [light picker](color-type/light-picker.png).

## Platforms

| Platform | Result |
| --- | --- |
| Headless Chromium on macOS (Playwright) | 22/22 passed |
| macOS WKWebView (the app) | Not checked (`accept:local`) |
| Windows WebView2 | Not checked |

## Not verified

- The picker in WKWebView: the popover top layer, the placement above the canvas, keyboard use in the panel, and the look of the compact inline picker.
- A press that starts in a node picker does not move the node. This was checked with a mouse in Chromium only, not with a trackpad or a pen.
- `docs/evaluation/fps-counter/editor-check.mjs` uses the old `.color-text` selector of the B19 field. It is historical evidence and was not changed.
