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
| 3.13. Save, relaunch, open, press ⌃⌥H | FAIL | See Findings |
| 3.14. Bind ⌘Space | FAIL | See Findings |

### Timing

The OBS timing comes from timestamps of `GetSourceScreenshot` polls on the same Mac. For ⌃⌥J, the marker showed and then hid after 1985 ms (samples about 11 ms apart). With graph B not compiling, the interval was 2056 ms (samples about 73 ms apart). The scene revision rose by 2 for each ⌃⌥J cycle and by 1 for each ⌃⌥K or ⌃⌥H press. App timing is unknown: no app-side tick timestamp was captured. The key-press instant is known only to about 0.2 s, so the key-to-pixel latency is unknown.

### Step 3.10 changed

Graph A has no data wire: Toggle Visibility has only a flow input. I used graph B, which has a Boolean wire into Set Visibility. I disconnected that wire through `blueprint_edit`. The reply and `blueprint_inspect` reported "Blueprint input is not connected". The editor showed the same text ([screenshot](blueprint-interactions-editor-compile-error.png)). ⌃⌥J still showed and hid the marker with the last valid version. I reconnected the wire through `blueprint_edit`; the error cleared in the editor ([screenshot](blueprint-interactions-editor-reconnected.png)). The wire edits used MCP-style calls, not canvas gestures.

### Step 3.11

With graph B disabled, ⌃⌥J caused no scene change. I could not show that the key reaches the focused app for J or K: a test window in front did not receive ⌃⌥J or ⌃⌥K even after OpenSekai quit, so another process on this Mac holds them. For H, the test window received ⌃⌥H when graph A was disabled. It did not receive ⌃⌥H while graph A was enabled.

### Step 3.12

The real stdio MCP server (`apps/mcp/src/cli.ts`) listed 13 tools, including `blueprint_edit`, `blueprint_inspect`, and `blueprint_run`. It listed `opensekai://blueprints`. `blueprint_edit` renamed graph C. The open editor showed the new name, and the selected node and its inspector stayed, so the canvas was not mounted again.

## Findings

1. **Hotkeys do not fire after a relaunch until a later Blueprint edit.** Repro: quit, relaunch, replace the scene and graphs, press ⌃⌥H: no effect. Any later `blueprint_edit` (for example `moveNode`) makes ⌃⌥H work. The GUI Save As and Open flow showed the same result: the saved show opened with three graphs, and the first ⌃⌥H presses did nothing. The editor was on the Assets panel. The same graphs fired at once when I created them through three `blueprintEdit` batches at the start. The cause is not known.
2. **A combination that macOS holds gives no warning.** I bound ⌘Space. `appStatus.warnings` stayed empty. ⌘Space fired the graph and Spotlight also opened. The contract expects a warning for a failed registration; macOS did not fail it. The editor warning text was not seen.
3. **Hotkeys stopped twice without a known cause.** After the first minimize and again after the first compile-error edit, several ⌃⌥H presses did nothing. Disabling and enabling graph A fixed the first case; reconnecting the wire fixed the second. I could not repeat the stop in 14 presses in a row. The OBS test source was crashing at about the same times (see below). The cause is unknown.

## Different behavior

A registered combination is held by OpenSekai. Other apps do not receive it. This differs from Warudo. A live Warudo comparison was not possible: Warudo stops at "Initializing" on the VMPal Windows guest because Unity's Direct3D 11 device is removed on the VirtIO GPU.

## Environment notes

OBS crashed twice with SIGSEGV in `GetSourceScreenshot` (`device_get_render_target`) while I polled about 100 screenshots a second. I reduced polling to about 15 a second. The release build ran with the default `CARGO_TARGET_DIR`, so the app is in the worktree `target` folder. The Mac was in use by the user. Several key presses reached the user's foreground app (Arc) while a hotkey test was in progress; no text field was typed into.

## Not exercised

Canvas drag and connect gestures, typing into the keystroke capture field, the editor warning for a held combination, a physical held key, Windows, and the app-side tick timing.
