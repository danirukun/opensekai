# Character model editor check

Checked 2026-10-10 on macOS at commit `3e7ca43`. The tree at this commit is the same as the merge commit `d82a724` on `main` (PR #143). The app ran with `pnpm --filter @opensekai/desktop tauri dev` (debug build, WKWebView). The Rust build gave no warnings. The renderer backend was not recorded. The show was a new show with one camera.

The operator asked the agent to run a smoke check before the merge. The agent drove the app with synthetic macOS pointer and key events and captured only the app windows. OBS was not connected.

## Automated checks

At commit `3e7ca43`: `pnpm check` passed with 0 errors and 0 warnings. `pnpm test:unit`: 595 tests in 89 files passed. `pnpm test:integration`: 9 tests in 4 files passed. `cargo test --workspace`: 150 tests passed, 1 was ignored, 0 failed. `vite build` for the desktop and output apps gave no warnings.

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Open the Assets Plus menu | PASS. The menu shows Camera, Character, VMC Receiver, iFacialMocap Receiver, and MediaPipe Tracker | — |
| 2. Add › Character | PASS. A character without a model appeared under Characters. The Inspector showed the Model row with Choose VRM…, Idle animation, and Body source | [add](character-model-editor-add.png) |
| 3. Scene preview with the performance monitor visible | PASS. The monitor showed 56 FPS (range 0–60). The character without a model rendered nothing | [scene](character-model-editor-scene.png) |
| 4. Blueprints: new graph, canvas menu add of Gate, ⌘Z, Variables drawer | PASS. This step checks the merge with PR #142 | — |

The app log had no errors, warnings, or panics.

## Limits

- No VRM was loaded through the editor, because the Model row opens the native file picker. The load status overlay, model replacement, and load failure were not seen live. The Safari load timing is in [character model loading](character-model-loading.md).
- The monitor was already visible. Its toggle, panel switching, and persistence after restart were not exercised.
- OBS was not connected. OBS timing and output isolation were not checked.
- The input events were synthetic. No Windows run.
