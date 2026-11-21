# Material values: macOS check

Date: 2026-11-21. Contract: [material parameter control](../../spdd/prompt/2026-11-16-material-parameter-control.md) (B38 PR 4, R19–R31). Code commit: `d88f05c2`. Platform: macOS 27.2.1 (arm64), Node v26.13.0, three 0.187.0, Playwright 1.65.0 (headless Chromium). The desktop app and OBS did not run. The look in the running app and the OBS alpha are `accept:local` items (see the list at the end).

## What changed

- Characters and props save material values by material name in the optional entity field `materials`. The op `setMaterialValues {entityId, materials}` replaces the group; `{}` removes all (R19–R20). No migration: an old show has no field.
- The Set and Reset Character and Prop Material Property nodes write through the override layer with the keys `material:<parameter>:<name>`. A transition is 0 to 3 s, with OutCubic as the default easing. A color mixes in linear light. A commit is one `setMaterialValues` op for each entity (R21–R27).
- The renderer writes the saved values after the pose and the expression update, so a saved value wins over an expression color bind. An outline parameter goes to the MToon outline clone only. A VRM 0 Unlit Base Color also writes the shade color. Each prop instance has its own copy of each material (R28).
- The Inspector has a Materials section after Meshes (character) or Prop (prop) (R29).
- MCP `material_list` adds `value` and `unknown`; the `scene_patch` text names `setMaterialValues`; `opensekai://blueprint-nodes` lists the parameters (R30).

## Requirement evidence

| Requirement | Evidence |
| --- | --- |
| R19–R20 saved values and op | `packages/contracts/test/material-values.test.ts`, `packages/session/test/material-values-patch.test.ts`, Rust `crates/contracts/tests/character_model.rs` |
| R21–R27 nodes, override layer, transitions | `packages/contracts/test/material-nodes.test.ts`, `packages/session/test/material-overrides.test.ts`, `packages/session/test/material-nodes.test.ts`, `apps/desktop/test/material-node-fields.test.ts` |
| R28 renderer | `packages/renderer/test/material-values.test.ts`, `packages/renderer/test/prop.test.ts` (scene graph and material fields, no GPU draw); look: `accept:local` |
| R29 Inspector | `apps/desktop/test/inspector-sections.test.ts`, `apps/desktop/test/material-section.test.ts`, headless check below |
| R30 MCP | `apps/mcp/test/material-values.integration.test.ts` (real stdio MCP process and real session), `packages/session/test/material-list.test.ts`, Rust `service_integration.rs` reply cases |
| R31 documents | `ARCHITECTURE.md`, `docs/warudo-parity.md` (CHR-07, ENV-03, MAT-08), B33 contract R4 |

## Headless editor check

`docs/evaluation/material-values/editor-check.mjs` runs the Editor window build in headless Chromium with the session in the page (the publisher). A stand-in for the Tauri host serves the build and the fixture VRM (`fixture_vrm_1`). The record has the material list that the importer reads from the file. All 13 materials of that model are opaque, so the stand-in record marks `Body_00_SKIN` as a blend material: then the Opacity row shows. The viewport draw is not part of the check.

Run from the repository root after `pnpm build` and `pnpm fixtures`:

```text
pnpm exec tsx docs/evaluation/material-values/editor-check.mjs docs/evaluation/material-values
```

Output: [editor-check.txt](material-values/editor-check.txt), 22/22 passed.

Screenshots (light and dark themes):

- Materials section with a saved Base Color and Opacity: [light](material-values/materials-section-light.png), [dark](material-values/materials-section-dark.png).
- A saved material that the model does not have (`Cape (Missing)`), read-only rows with reset marks: [light](material-values/materials-missing-light.png), [dark](material-values/materials-missing-dark.png).
- Set Character Material Property node fields: [light](material-values/material-node-light.png), [dark](material-values/material-node-dark.png); with a missing material: [light](material-values/material-node-missing-light.png), [dark](material-values/material-node-missing-dark.png).

## Automated checks

Run on the branch head before the documents commit.

| Check | Result |
| --- | --- |
| `pnpm check` | 0 errors, 0 warnings (svelte-check: 5915 files) |
| `pnpm test:unit` | 302 files, 2842 passed, 1 failed. The failure is `packages/contracts/test/meshes.test.ts` (`fixture_vrm0_arkit` is not in the local fixture manifest); it fails the same way on the base commit. |
| `pnpm test:integration` | 51 files passed, 1 skipped; 128 tests passed, 5 skipped |
| `cargo test --workspace` | 61 suites, 632 passed, 0 failed, 2 ignored |
| `cargo clippy --workspace --all-targets` | 0 warnings |
| Headless editor check | 22/22 |

A first `cargo test` run at the same time as `pnpm test:unit` failed the timing test `due_clocks_progress_under_sustained_control_without_credit_accumulation` (`clock_integration.rs`). It passed in the run alone above.

## Platform table

| Platform | Backend | Result |
| --- | --- | --- |
| macOS 27.2.1 arm64, Node | none (scene graph and fields) | Unit and integration tests pass |
| macOS 27.2.1 arm64, headless Chromium | software adapter, viewport not checked | Headless editor check 22/22 |
| macOS desktop app (WKWebView), OBS | not run | `accept:local` |
| Windows | not run | unknown |

## Local checks (`accept:local`)

Build from this branch right before the check. Use the Catboy ARKit VRM and two props of one Bonnie stage asset. OBS WebSocket at `ws://127.0.0.1:4455`, an isolated test source, no stream.

1. Set Base Color with 1 s OutCubic on the body material: the change fades. Reopen the show: the color stays.
2. Reset with 1 s: the color fades back to the model color with no jump at the end.
3. Opacity 0.5 on a blend material: OBS shows the alpha. Record a frame.
4. Outline Width and Outline Color on an outlined material. The Outline Width has an effect only when the model outline width is more than 0, because three-vrm makes no outline clone for a material without an outline.
5. An expression with a color bind on the same material: the graph value stays.
6. One prop changed, the other prop of the same asset unchanged.
7. Change the character model to one without that material: the Inspector shows `(Missing)`. Change back: the value applies again.
