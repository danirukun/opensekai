# Blueprint files check

Checked 2026-10-13 on macOS. The automated checks and the runner ran at commit `07bda9f`. The live UI check ran at commit `e0a7c40` (branch `opensekai/blueprint-files`), which includes the change to the Blueprint list. The build was a debug build from `pnpm dev:desktop` in the worktree (WKWebView). The operator did the input in the dialogs. The controller took the screenshots and read the state through MCP.

The renderer backend was not recorded. OBS was not running, so the OBS output was not checked. The show was the operator's `Demo Show`. It has the entities Camera Full (`camera_main`), the character REM, and Camera Close Up.

## Automated checks

At commit `07bda9f`: `pnpm check` passed with 0 errors and 0 warnings. `pnpm test:unit`: 636 tests in 96 files passed. The command exits with status 1 because of 16 unhandled errors ("content doesn't have 'target' for reordering") from the Rete area plugin in a test DOM. `main` has 15 to 16 of these errors, and the continuous Blueprints check recorded 16. `pnpm test:integration`: 21 tests in 7 files passed. The implementer reported 23 tests after the runner follow-up at the same commit. `cargo test --workspace`: 166 tests passed, 0 failed.

## End-to-end runner

`pnpm evaluate:blueprints` ran at commit `07bda9f` on the plain dev app. All 10 cases passed: it rejects a future-version file, an unknown node, and a Warudo-shaped file, and it imports `nudge`, `drift`, `wasd`, `camera-flip`, `counter`, `renamed-ids`, and `missing-ref`. Session `cc7613f0-79a9-4ad2-b55e-4f3cde8bfb21`. Report: [blueprint-files-run.json](blueprint-files-run.json).

After the run, the app scene had only `camera_main` and 0 Blueprints (read through MCP).

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Import `counter.json` into `Demo Show` | PASS (operator). The status line showed `Missing: camera_close, camera_wide`. The Switch Camera Camera field showed **Missing**. The graph was imported disabled | — |
| 2. Choose the cameras and enable the graph | PASS. MCP showed Counter enabled, with Switch Camera set to `camera_main` and Camera Close Up | [editor](blueprint-files-editor.png) |
| 3. Export the graph | PASS (operator). The dialog was titled `Export Blueprint`, the name was `Counter.json`, and the file was saved | — |
| 4. Import the exported file | PASS (operator). A second Counter graph was added, with no Missing line | — |
| 5. Import `warudo-shaped.json` | PASS (operator). The panel showed "Not an OpenSekai Blueprint file". No graph was added | — |
| 6. Click **Import**, then **Cancel** | PASS (operator). Nothing changed | — |
| 7. Blueprint list after the UI change | Shown. Export and Delete appear on hover, on focus, or on the selected row. Graphs were added through MCP for the screenshot, then removed | [list](blueprint-files-list.png) |

## Findings during the check

- The first runner attempt found a defect in the plan. A new app session has the scene `scene_smoke`, but it has only `camera_main` (an empty authoring scene). Fixture mode (`OPENSEKAI_FIXTURE_MANIFEST`) needs a prepared local asset manifest, and the service did not start without it. Ruling: the runner requires `scene_smoke` and no Blueprints. It adds the missing smoke entities as placeholders (a reference box mesh, a performer avatar without a model, `camera_wide`, and `camera_close`) and removes them at the end. The spec (R14) has this change.
- During the check, the operator asked for a change to the Blueprint list. The header buttons were large outlined boxes. They are now small borderless icons, and the rows show Export and Delete on hover, on focus, or when selected (commit `e0a7c40`).
- The worktree is in the hidden `.worktrees` folder, so Finder did not show the fixtures. The operator used copies in `~/Downloads`.

## Limits

- Physical WASD after an import into the show was not checked. The `wasd` graph was already in the operator's show from the previous slice, and it was not imported again. The runner imports `wasd`, but it does not press keys.
- The runner registered the keys of `camera-flip` and `counter` but did not fire them, because it cannot send a global hotkey. The session integration test covers their effect.
- The operator imported the exported file again in the same show, without an app restart. A restart and a second show were not checked.
- OBS was not running. The `drift` motion in the OBS output, alpha, and OBS timing were not checked.
- Windows was not checked.
- Different: on macOS the file dialogs do not filter to `.json`. The existing Open and Import dialogs have the same behavior (an `rfd` file-type filter issue).
- Different: OpenSekai does not read Warudo files, by design. The Warudo-shaped file is rejected.
- App timing was not measured. The renderer backend was not recorded.
