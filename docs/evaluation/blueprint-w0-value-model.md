# Blueprint value model check (W0)

Checked 2026-10-18 on macOS 27.0.1 (arm64), Node 26.12.0, pnpm 12.8.1. Base commit: `671e2f8` (plan commit on `opensekai/blueprint-depth`). Branch: `opensekai/bp-w0-value-model`. Contract: [Blueprint value model](../../spdd/prompt/2026-10-18-blueprint-w0-value-model.md).

This check covers the automated tests only. The desktop app was not started and Rust was not built in this slice (batch plan: one integrated macOS QA run later). The renderer backend, the quality profile, and OBS do not apply to these checks.

## Automated checks

| Command | Base `671e2f8` | This branch | Notes |
| --- | --- | --- | --- |
| `pnpm check` | — | Pass. svelte-check: 0 errors, 0 warnings | 8 packages and `tsconfig.scripts.json` |
| `pnpm test:unit` | 1017 passed (136 files) | 1040 passed (138 files), 0 failed | |
| `pnpm test:integration` | 33 passed, 4 failed, 2 skipped (39) | 38 passed, 0 failed, 2 skipped (40) | See the note below |
| `cargo test --workspace` | not run | not run | Not built in this slice. See "Not verified" |
| `rustfmt --edition 2021 --check` on `crates/contracts/src/lib.rs` and `crates/contracts/tests/blueprint.rs` | — | Clean | Parses the changed Rust files. It does not compile them |

The 4 integration failures on the base commit are in `scripts/prepare-tracking.test.ts`. Each one is `ENOENT ... artifacts/models/face_landmarker.task`: a new worktree has no ignored `artifacts/models/` folder. After a copy of that folder from the main checkout, the same command gave 38 passed and 2 skipped on this branch. The failures are not related to this slice.

## What the tests cover

- Contracts (`packages/contracts/test/blueprint-value-model.test.ts`): the ten data types, `canConnect` (integer to number only), defaults, value shapes, limit and type problems, variables of each type (shared vector `fixtures/protocol/blueprint-variables.json`, `typed`), retype defaults, inline value validation (including a `__proto__` key), `unconnectedInputValue`, `setNodeInput` set, clear, and reject, the settings prune and the settings check before it, and the Blueprint file and show round trip.
- Session (`packages/session/test/blueprint-value-model.test.ts`): through `createSession` on the smoke scene, a Set Asset Property with an inline Vector3 commits that position; a wire from a Make Vector3 with inline values wins; after the wire is removed, a new inline value applies; after a clear, the input reads `[0, 0, 0]`. String, list, and integer variables keep their values through `updateVariable` and in the initial run state. `checkBlueprintValue` and the generic node state copy.
- Changed session tests: a graph with an unwired data input now compiles. The tests that needed a compile error now use a Get Number Variable node with a missing variable.
- MCP (`apps/mcp/test/blueprint-values.integration.test.ts`, stdio boundary with a real session): typed variables and an inline value through `blueprint_edit`, a rejected inline value, `blueprint_inspect`, `blueprint_run`, and `dataTypes` in the node resource.
- Editor: list and scalar text parsers, typed new variables, undo of inline values (with merge) and of an inline value that a settings change dropped, the canvas patch, and the wired-input set and `setNodeInput` of the Rete adapter.
- Rust (`crates/contracts/tests/blueprint.rs`): typed variables, inline inputs, and `setNodeInput` structure checks. Written, not run.

## Not verified

- `cargo test --workspace` and `cargo clippy`: the Rust contract checks changed (`crates/contracts`) and were not compiled. The integrated QA run must build and test them.
- The editor in the running app: the socket colors, the inline editors on nodes (number, integer, checkbox, text, Vector3), pointer and key handling in an inline editor, the Variables drawer for each type, the list text area, and the inspector field kinds.
- A session test of an integer to number wire, of a rejected number to integer wire, and of a run that fails at a size limit. No W0 node has an integer port or makes a string or a list. Wave 2 adds these tests with its first such node.
- Save and open of a show with inline values and typed variables through the Rust host (`show.rs` uses `validate_blueprint_set`).

## macOS QA steps

1. Build and run `cargo test --workspace --no-fail-fast` and `cargo clippy --workspace --all-targets`.
2. Start the app. In a Blueprint, add Manual Trigger and Set Asset Property (Position of a box). Do not wire `value`. Type `1, 2, 3` in the three inline fields, then Run. The box moves to (1, 2, 3) in the preview and the OBS output.
3. Add Make Vector3, type values on its inline fields, and wire it to `value`. The inline editor on `value` goes away. Run: the box takes the Make Vector3 value. Remove the wire: the inline editor comes back with (1, 2, 3).
4. Click into an inline field and press Delete, Backspace, ⌘Z, and ⌘A. The node stays, and the keys edit the text. Drag on an inline field: the node does not move.
5. Type `abc` in a number field and `2.5` in an Add input: the field goes back to the stored value for an invalid entry. ⌘Z after an inline edit restores the old value.
6. In the Variables drawer, add a variable of each type. Change a default for each type, including a list with one item on each line and a Vector3 list (`0, 1, 0`). Change a type and check that the default resets.
7. Save the show, close it, and open it again. The inline values and variables are the same. Export the Blueprint and import it again.
8. Check that the socket colors of number, boolean, Vector3, and the new types differ, and that a list socket is square (when wave 2 adds list ports).
9. Through MCP, run `blueprint_edit` with `setNodeInput`, and read `opensekai://blueprint-nodes` (`dataTypes`, `categories`).
