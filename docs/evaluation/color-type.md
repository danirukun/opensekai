# Blueprint Color type and kit color picker check (B38)

Checked 2026-11-20 on macOS 27.2.1 (arm64), Node 26.13.0, pnpm 12.8.1, Playwright 1.65.0 (headless Chromium). Branch: `claude/b38-color-type`. Base: `fd4fe09b` (`origin/main`). Commits: `1ed87574` (kit pin), `3d05360e` (type and nodes), `d562583b` (pickers), and the review fixes `2fa6e0a7`. Kit: `49c63867a6bba5815ad5ed71a10580e945ad8fa4` (kit 0.2.0, with ColorPicker). Contract: [material parameter control, R7–R12 and R31](../../spdd/prompt/2026-11-16-material-parameter-control.md).

The desktop app was not started. The renderer backend, the quality profile, and OBS do not apply to these checks. The macOS WKWebView editor is not checked (`accept:local`).

## Automated checks

| Command | Base `fd4fe09b` | This branch | Notes |
| --- | --- | --- | --- |
| `pnpm check` | 0 errors | 0 errors, 0 warnings | |
| `pnpm test:unit` | 2732 passed, 1 skipped (286 files) | 2740 passed, 1 skipped (287 files), 0 failed | The review fixes add one Rete test and remove the `parseLightColor` test |
| `pnpm test:integration` | 118 passed, 7 skipped (46 files passed, 3 skipped) | 124 passed, 7 skipped (47 files passed, 3 skipped) | Six ColorField tests in Chromium |
| `cargo test --workspace --no-fail-fast` | 625 passed, 1 failed, 2 ignored (61 suites) | 626 passed, 0 failed, 2 ignored (61 suites) | The base failure was the known `clock_integration` timing flake |
| `cargo test -p opensekai-contracts` (after the review fixes) | — | 154 passed, 0 failed (40 suites) | The shared vector has a Break Color node with an inline color |
| `cargo clippy --workspace --all-targets` | 0 warnings | 0 warnings | |
| `cargo fmt --all -- --check` | 2 files differ | 2 files differ | `recent_shows.rs` and `tracking/parser.rs`, not changed here |

## What the tests cover

- Kit (R7): `docs/dependencies.md` names the kit commit above, and the snapshot comes from it.
- Value model (R8): `color` is a scalar type with the label Color and the default `#ffffff`. A value is a lowercase `#rrggbb` string. Uppercase, `#rgb`, and `#rrggbbaa` are rejected. Color does not connect to or from String. The zod schema and the fast check agree on a sample set. Color lists use the same rule for each item. The shared vector `fixtures/protocol/blueprint-variables.json` has a Color and a Color list variable, a Break Color node with the inline color `#ff8000`, and three rejected variable cases; the TypeScript and Rust contract tests read it. TypeScript rejects an inline `#FF8000` or `orange` on the Break Color input. Rust checks the inline value shape only, as for the other types, so this rejection is a TypeScript test.
- Nodes (R9): Color gives its setting. Make Color clamps each channel to 0–1, reads a non-finite channel as 0, and rounds to the nearest of 255 steps. Break Color gives byte / 255, and Make Color of the Break Color outputs gives the same color. The catalog has 194 entries.
- Editor text (R10): `parseScalar('color', …)` accepts `#rgb` and `#rrggbb`, with or without `#`, in any case, and gives the lowercase long form.
- Debug text, the string form, and Format String (R8): a color shows as its hex text.
- ColorField (R11), `apps/desktop/test/color-field.integration.test.ts`, in Chromium with a stand-in host: a pointer drag gives live colors, one `onend`, and no `oncommit`; the picked color stays for 500 ms when no scene update comes; a drag that returns to its start color and ends by `pointercancel` gives one `onend`, and the field then follows the scene; Shift+ArrowDown with Shift released first gives one live color, one `onend`, and no `oncommit`; a typed hex gives one `oncommit` and no `onend`; a typed hex that the host does not take is replaced by the scene color after 1 s. The Shift, cancel, and rejected-hex tests failed before the fix.
- Node drag guard (R10), `apps/desktop/test/rete-editor.test.ts`: a press in a color picker keeps the node still and sends no `moveNode`; a session move during that press still places the node; after the release a user drag sends `moveNode`. The test failed before the fix for the session move.
- No migration (R12): the existing fixtures and tests still pass with `formatVersion: 1`, and the extension port types do not change.

## Headless editor check

`pnpm build`, then `pnpm exec tsx docs/evaluation/color-type/editor-check.mjs docs/evaluation/color-type`. Output: [editor-check.txt](color-type/editor-check.txt). Result: 24/24 passed.

- R10: the color socket has its own color (a conic gradient of the theme tokens).
- R10: the inline picker on the unconnected color input of Break Color, at zoom 1 and at zoom 0.48. At each zoom, the panel is inside the viewport, it is the element at its own center, and it is 15rem wide (the canvas does not scale it). A drag in the panel sends one `setNodeInput` with a new color, and the node does not move. Escape closes the panel.
- R10: a drag in the Value picker of a Color node sends one `setNodeSettings`.
- R10: `#336699` typed in a Color variable default sends one `updateVariable`.
- R11: on a new Point Light, a drag in the Inspector Color picker sends 9 live `setLight` patches and none after the pointer is released. The scene holds the shown color. A typed `#00ff00` sends one `setLight` patch.
- R11: the FPS Counter Color, the camera Grading Tint, the camera Vignetting and Night Vision Color, and the avatar Rim Tint each open the kit picker inside the viewport.
- No page error. Headless Chromium logs WebGPU validation errors and a device loss from the preview renderer; they are console messages, not page errors, and the check does not count them. In one of four runs after the review fixes, the WebGPU preview renderer raised the page error `Instance dropped in popErrorScope` after the avatar was added; the other three runs had no page error.

Screenshots: [node picker at zoom 1](color-type/node-picker.png), [light picker](color-type/light-picker.png).

## Platforms

| Platform | Result |
| --- | --- |
| Headless Chromium on macOS (Playwright) | 24/24 passed |
| macOS WKWebView (the app) | Not checked (`accept:local`) |
| Windows WebView2 | Not checked |

## Not verified

- The picker in WKWebView: the popover top layer, the placement above the canvas, keyboard use in the panel, and the look of the compact inline picker.
- A press that starts in a node picker does not move the node. This was checked with a mouse in Chromium only, not with a trackpad or a pen.
- A host that rejects a typed hex: the field shows the scene color again after 1 s through a remount of the kit picker. The kit does not resync its own value when the parent value does not change; a kit change would remove the timer.
- `docs/evaluation/fps-counter/editor-check.mjs` uses the old `.color-text` selector of the B19 field. It is historical evidence and was not changed.
