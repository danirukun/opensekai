# Blueprint interactions check

Checked 2026-10-08 on macOS from source commit `67cffe2`. The check used the release app from `pnpm build:mac` (37.70 MiB). The preview reported the WebGPU backend. No quality profile was selected. No fixture mode was used. The avatar was one user-supplied VRM from the app library; the file is not in the repository. OBS 32.2.2 used an isolated scene `OpenSekai-BP-Test` with a browser source (1920x1080, 60 fps). OBS did not stream or record. The test scene and source were removed, and the prior OBS scene was restored.

Evidence index: [blueprint-interactions-evidence.json](blueprint-interactions-evidence.json).

## Automated checks

`pnpm check` passed. `pnpm test:unit`: 461 tests in 69 files passed. `pnpm test:integration`: 9 tests in 4 files passed. `cargo test --workspace`: 128 tests passed, 1 was ignored, 0 failed.

## Setup

I built the scene and the graphs through the shared commands, not through canvas gestures. `scene_patch` added the avatar, a hidden box marker, and two cameras (close and wide). `blueprint_edit` created graph A (⌃⌥H, Toggle Visibility on the avatar), graph B (⌃⌥J, Set Visibility true on the marker, Delay 2 s, Set Visibility false), and graph C (⌃⌥K, Flip Flop, Switch Camera close or wide). The open editor listed the three graphs and drew graph A with no user action ([screenshot](blueprint-interactions-editor-remote-graphs.png)). Canvas drag and connect gestures were not exercised.

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Full checks | PASS | Counts above |
| 2. Release build and OBS source | PASS | OBS showed the transparent avatar output |
| 3.1 to 3.4. Avatar, marker, graphs A, B, C | PASS, with the setup above | Editor screenshot above |
| 3.5. Editor minimized, OBS in front | PASS | OBS was frontmost for each key press |
| 3.6. Press ⌃⌥H twice | PASS | OBS visible pixels went 11392 to 0 to 11392 (480x270 sample) |
| 3.7. Hold ⌃⌥H for 2 s | PASS, synthetic keys only | Three holds toggled once each: modifier events, bare key events, and 56 autorepeat key-down events |
| 3.8. Press ⌃⌥J | PASS | [OBS image](blueprint-interactions-obs-marker-shown.png) |
| 3.9. Press ⌃⌥K twice | PASS | [close](blueprint-interactions-obs-camera-close.png), [wide](blueprint-interactions-obs-camera-wide.png) |
| 3.10. Break a data wire, key stays bound | PASS, on graph B | See below |
| 3.11. Disable graph B, press ⌃⌥J | PASS for "nothing happens"; the key test is partly UNKNOWN | See below |
| 3.12. Rename graph C through MCP | PASS | [before](blueprint-interactions-editor-before-rename.png), [after](blueprint-interactions-editor-renamed-via-mcp.png) |
| 3.13. Save, relaunch, open, press ⌃⌥H | FIXED, re-checked on commit `954b5cf` (API path only) | See Findings and Re-check |
| 3.14. Bind ⌘Space | Different (expected) | See Findings |

### Timing

The OBS timing comes from timestamps of `GetSourceScreenshot` polls on the same Mac. For ⌃⌥J, the marker showed and then hid after 1985 ms (samples about 11 ms apart). With graph B not compiling, the interval was 2056 ms (samples about 73 ms apart). The scene revision rose by 2 for each ⌃⌥J cycle and by 1 for each ⌃⌥K or ⌃⌥H press. App timing is unknown: no app-side tick timestamp was captured. The key-press instant is known only to about 0.2 s, so the key-to-pixel latency is unknown.

### Step 3.10 changed

Graph A has no data wire: Toggle Visibility has only a flow input. I used graph B, which has a Boolean wire into Set Visibility. I disconnected that wire through `blueprint_edit`. The reply and `blueprint_inspect` reported "Blueprint input is not connected". The editor showed the same text ([screenshot](blueprint-interactions-editor-compile-error.png)). ⌃⌥J still showed and hid the marker with the last valid version. I reconnected the wire through `blueprint_edit`; the error cleared in the editor ([screenshot](blueprint-interactions-editor-reconnected.png)). The wire edits used MCP-style calls, not canvas gestures.

### Step 3.11

With graph B disabled, ⌃⌥J caused no scene change. I could not show that the key reaches the focused app for J or K: a test window in front did not receive ⌃⌥J or ⌃⌥K even after OpenSekai quit, so another process on this Mac holds them. For H, the test window received ⌃⌥H when graph A was disabled. It did not receive ⌃⌥H while graph A was enabled.

### Step 3.12

The real stdio MCP server (`apps/mcp/src/cli.ts`) listed 13 tools, including `blueprint_edit`, `blueprint_inspect`, and `blueprint_run`. It listed `opensekai://blueprints`. `blueprint_edit` renamed graph C. The open editor showed the new name, and the selected node and its inspector stayed, so the canvas was not mounted again.

## Findings

1. **Hotkeys stopped after the publisher connection dropped and came back (fixed).** The host cleared its registrations when the publisher dropped. The worker kept its session and graphs and reconnected. Nothing registered the keys again until a later `blueprint_edit` made the host register them. A drop happens when the worker misses the 2 s clock credit, for example while the page is busy. Repro A (relaunch, scene replace, graph edit, press) and the first 3.13 failure had this shape. The cause is proven with a stall of the web networking process (see Re-check). The Save As and Open flow was not run again.
2. **A combination that macOS holds gives no warning (expected).** I bound ⌘Space. `appStatus.warnings` stayed empty. ⌘Space fired the graph and Spotlight also opened. The warning covers an OS registration failure only. macOS accepts a combination that a system feature such as Spotlight also uses, and both then fire. This is Different from Warudo. The editor warning text was not seen.
3. **Hotkeys stopped twice during the session (same cause).** After the first minimize and again after the first compile-error edit, several ⌃⌥H presses did nothing. Each time an edit that went through the host registered the keys again. I could not repeat the stop with presses alone. The connection drop explains both stops.

## Re-check of step 3.13

Commit `954b5cf` (release build, default window state, Finder in front, ⌃⌥H sent with `osascript`). The test froze the app's web networking process for 4 to 5 s with `kill -STOP` and `kill -CONT`. This makes the publisher miss its clock credit and reconnect. I read the scene state through the operator connection (`scene_inspect`), not OBS.

| Build | Run | Result |
| --- | --- | --- |
| Before the fix (`7225fa7`) | Freeze, wait, 3 presses | No change in the scene. After one `blueprint_edit` (`moveNode`), the next press toggled the avatar. |
| After the fix | Relaunch, scene replace, graph edit, 2 presses | Both presses toggled the avatar. |
| After the fix | 3 freeze cycles with 2 presses each, waiting 25 s after each freeze | All 6 presses toggled the avatar. |

The host asks the publisher for its accelerator set after the publisher answers a clock with a frame. A call sent earlier made the worker miss its credit again in the freeze test, so the host waits for the first frame. The fix is covered by integration tests in `apps/desktop/src-tauri/tests/keystroke_integration.rs`.

## Different behavior

A registered combination is held by OpenSekai. Other apps do not receive it. This differs from Warudo. A live Warudo comparison was not possible: Warudo stops at "Initializing" on the VMPal Windows guest because Unity's Direct3D 11 device is removed on the VirtIO GPU.

## Environment notes

OBS crashed twice with SIGSEGV in `GetSourceScreenshot` (`device_get_render_target`) while I polled about 100 screenshots a second. I reduced polling to about 15 a second. The release build ran with the default `CARGO_TARGET_DIR`, so the app is in the worktree `target` folder. The Mac was in use by the user. Several key presses reached the user's foreground app (Arc) while a hotkey test was in progress; no text field was typed into.

## Not exercised

Canvas drag and connect gestures, typing into the keystroke capture field, the editor warning for a held combination, a physical held key, Windows, and the app-side tick timing.
