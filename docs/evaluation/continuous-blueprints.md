# Continuous Blueprints check

Checked 2026-10-13 on macOS at commit `05d2b31` (branch `opensekai/continuous-blueprints`). The operator did the physical key input. The agent built the graph through the MCP CLI and read the scene and status through MCP. The app ran two times:

1. A debug build from `pnpm dev:desktop` in the worktree (WKWebView). The terminal app started this build, so macOS used the Input Monitoring access of the terminal.
2. A release build from `pnpm build:mac`, started with `open` on the bundle path, so macOS asked for access for OpenSekai.

The renderer backend was not recorded. OBS was not running, so the OBS output was not checked. The show was the operator's `Demo1.osekai` with the VRM character REM.

## Automated checks

At commit `05d2b31`: `pnpm check` passed with 0 errors. `pnpm test:unit`: 623 tests in 94 files passed. The command exits with status 1 because of 16 unhandled errors ("content doesn't have 'target' for reordering") from the Rete area plugin in a test DOM. `main` at `5ba90dd` has 15 of these errors. The new port retype test adds one. `pnpm test:integration`: 9 tests in 4 files passed. `cargo test --workspace`: 163 tests passed, 0 failed.

## Graph

On Update → Move Entity (REM, Local). The delta is Scale Vector3 (Make Vector3 (Key Axis (D, A), Number 0, Key Axis (S, W)), Multiply (Number 1.5, deltaSeconds)).

A VRM character faces +Z. In its local space, its right side is −X. The first graph used Key Axis (A, D) for X, so D moved REM to her left. With Key Axis (D, A), D moves REM to her right.

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Add the WASD graph through MCP `blueprint_edit` | PASS. The edit reply listed `heldKeys` A, D, S, and W. The graph compiled | — |
| 2. Hold W, A, S, and D with TextEdit and with Notes focused | PASS. REM moved in the Scene preview. Notes received W: holding W opened the accent menu. REM stopped when the key was released | [scene](continuous-blueprints-scene.png) |
| 3. Scene revision during motion | PASS. The revision did not change while a key was held. It increased by one after each release (1 → 54 over the debug session) | — |
| 4. Inspector after release | PASS. The Inspector showed the committed position. The fields show floating-point noise, for example `2.349000000000003` | [editor](continuous-blueprints-editor.png) |
| 5. Drag REM with the gizmo while W is held | PASS (operator). The drag position stayed after the key was released | — |
| 6. Release build: watched keys without access | PASS. macOS showed the Input Monitoring prompt. App status had the warning `FORBIDDEN` "Input Monitoring is off" | — |
| 7. Grant access | PARTIAL. macOS asked the operator to quit and open the app again. The in-app retry did not get the access without a restart | — |
| 8. Release build after the restart: hold W in Notes, then Save | PASS. REM moved and stopped. The saved `Demo1.osekai` has the WASD graph and REM at [-0.455, 0, -0.371] | — |

## Findings during the check

- When macOS opened OpenSekai again after the grant, it started an older release bundle from another worktree with the same bundle identifier. That build did not know Blueprint variables, and it rejected the show with "Invalid Blueprint graph". The current build opened the same file without an error. To prevent this, open the bundle by its path, or remove old bundles from Launch Services.
- The **Open Settings** action was not clicked in this check.

## Limits

- OBS was not running. The OBS output, alpha, and OBS timing were not checked.
- The behavior with secure input (a password field) was not checked. Key-up recovery through `CGEventSourceKeyState` is covered by the bookkeeping unit tests only.
- Windows has no key monitor. The stub reports "Held keys are unavailable on this platform".
- App timing was not measured.
