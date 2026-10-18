# Blueprint input devices check (slice I, BP-06 partial)

Date: 2026-10-18. Base: `opensekai/blueprint-depth` at `671e2f8`. Branch: `opensekai/bp-i-input-devices`. Contract: [input devices](../../spdd/prompt/2026-10-18-blueprint-i-input-devices.md). Issue: [#86](https://github.com/danirukun/opensekai/issues/86).

## Status

The tests below pass on macOS. The running app was not started in this slice. The integrated macOS run with a physical gamepad and a physical MIDI controller is still necessary (see [macOS acceptance](#macos-acceptance)). Do not check BP-06 from this note.

## Platform

| Platform | Result |
| --- | --- |
| macOS (Darwin 27.0.0, Apple silicon), Rust 1.93, Node 26.12, pnpm 12.8.1 | Unit, session, contract, Rust, and service integration tests pass. A CoreMIDI probe (below) passes. |
| Linux cloud | Not run. The gamepad and MIDI crates are macOS and Windows target dependencies, so the Linux build does not need udev or ALSA headers. Linux reports `UNSUPPORTED` for each used device kind. |
| Windows | Not run. `gilrs` (Windows.Gaming.Input) and `midir` (WinMM) compile for Windows by their documentation only. The pointer adapter is macOS only. |

## Crates

| Crate | Version | Use |
| --- | --- | --- |
| `gilrs` | `=0.11.2` | Gamepads (IOKit HID on macOS, Windows.Gaming.Input on Windows) |
| `midir` | `=0.11.1` | MIDI input (CoreMIDI through `coremidi` 0.9.2 on macOS, WinMM on Windows) |

No JavaScript dependency was added.

## Commands and counts

| Command | Pass | Fail | Skip | Notes |
| --- | --- | --- | --- | --- |
| `pnpm check` | 8 packages and scripts | 0 | 0 | svelte-check: 0 errors, 0 warnings |
| `pnpm test:unit` | 1032 (138 files) | 0 | 0 | |
| `pnpm test:integration` | 37 (14 files) | 0 | 2 | A new worktree needs `artifacts/models` (the MediaPipe models) first, or the 4 `prepare-tracking` tests fail with `ENOENT`. |
| `cargo test --workspace --no-fail-fast` | 305 | 0 | 1 | The skip is the pinned fixture benchmark test. |
| `cargo clippy --workspace --all-targets` | Clean | 0 | — | One existing `map_or` warning in `input/monitor.rs` (new clippy lint) is fixed. |

New tests:

- Contracts (TypeScript): `packages/contracts/test/devices.test.ts`, and 7 shared vectors (`clock-device-input*`) in `fixtures/protocol/validation-vectors.json` that both sides run.
- Contracts (Rust): `crates/contracts/src/devices.rs` unit tests, including the largest device clock (less than 16 KiB).
- Session: `packages/session/test/device-nodes.test.ts`. Note runs with note and velocity, channel and note filters, gamepad and pointer edges, pad and pointer state in On Update, Control Change state, and the used device kinds.
- Native: `input/devices.rs` (queue limits, Control Change coalescing, hub start and stop, problems), `devices/gamepad.rs` (dead zones, slots, snapshots, `gilrs` button names), `devices/midi.rs` (decoder), `devices/pointer.rs` (normalization, edges, held buttons).
- Integration (`apps/desktop/src-tauri/tests/device_input_integration.rs`): the real service WebSocket. A `blueprintEdit` reply with `devices` starts the fake adapters, device events and pointer state ride the clock, a publisher disconnect stops each adapter, and app status warns for a used kind without an adapter. 15 repeated runs passed.

## Local probe without a GUI

A scratch program (not committed) used `platform_hub()` from the desktop library with `midir` on this Mac. No physical gamepad or MIDI device was connected.

| Step | Result |
| --- | --- |
| List MIDI input ports and gamepads | 0 MIDI input ports, 0 gamepads. No permission prompt. |
| Start the MIDI adapter, then create a virtual CoreMIDI source and send Note On (channel 10, note 36) and CC 7 | The adapter connected the new source at its next scan. The first events arrived after 1.66 s. |
| Stop the adapter, send a note | No device input. |
| Start the adapter again | Events after 0.21 s (the same thread and run loop). |
| Remove the source, wait 3 s, create a second source | No crash, no problem status. The second source gave events after 1.03 s. |
| Start the pointer adapter | `x = 0.3551, y = 0.6175` (normalized to the main display), no held button. |
| Start the gamepad adapter | No state, no problem status. |

## Permissions

- Pointer: `CGEventCreate` with `CGEventGetLocation`, `CGDisplayBounds`, and `CGEventSourceButtonState`. These need no permission. The probe ran from a terminal, so a terminal grant can hide a prompt. The macOS run must confirm that the app asks for nothing new.
- MIDI: CoreMIDI needs no permission.
- Gamepad: `gilrs` opens an IOKit HID manager for game pads and joysticks. macOS asks for Input Monitoring for keyboard devices. It is expected not to ask for a game controller. The macOS run must confirm this. If macOS asks, record it, and the existing Input Monitoring path and warning apply.

## macOS acceptance

Run these steps in the integrated QA run, on the release app, with OBS. Use a gamepad (Xbox or DualSense over USB or Bluetooth), a USB MIDI controller with pads and a knob, and the mouse.

1. Gamepad. Build a graph: On Gamepad Button Pressed (Any, A / Cross) → Toggle Visibility. Give focus to another app. Press A: the entity toggles in the preview and in OBS, and the other app receives nothing new from OpenSekai. Hold the button: it toggles once.
2. Gamepad axis. On Update → Move Entity with Make Vector3 (Gamepad Axis Left Stick X, 0, Gamepad Axis Left Stick Y) scaled by deltaSeconds. The character moves with the stick, stops at rest (dead zone), and the scene revision changes once after the stick returns to rest.
3. Gamepad hot-plug. Disconnect the pad while the graph runs, and connect it again. The app does not stop, and the pad works again as pad 1.
4. Two pads (if available). Set Pad to 2 on a node: only the second connected pad starts it.
5. MIDI notes. On MIDI Note On (Any channel, Any Note) → Set Asset Property with the note and velocity in a Vector3, or a Branch on velocity. Press pads: the run uses the note and velocity. On MIDI Note Off fires on release (also for a controller that sends Note On with velocity 0).
6. MIDI knob. On Update → MIDI Control Value (the knob CC) → Set Asset Property (camera Field of View through math). The value follows the knob, 0 to 1. Disconnect and connect the controller while the graph runs: no crash, input returns within about 2 s.
7. Pointer. On Update → Pointer Position → Set Asset Property. The value follows the mouse over other apps and is 0 to 1 on the main display. On Pointer Button Pressed (Right) runs on a right click in another app, and that app still receives the click. Is Pointer Button Held is true while the left button is down.
8. Stop. Disable each graph. Check that `appStatus` has no device warning, and (Activity Monitor) that the MIDI and pointer adapters do no work. The gamepad thread stays and discards events (see the analysis).
9. Permissions. Confirm which prompt, if any, macOS shows for the gamepad, MIDI, and pointer. Record it in this note.
10. Record app timing and OBS timing separately, the renderer backend, and the commit.

## Known limits

- A pointer click shorter than one clock interval (about 16 ms) can be missed, because the adapter compares two reads.
- The gamepad identity is a player slot (1 to 4), not a stable hardware ID. A pad that reconnects can take a different slot when another pad holds the lower slot.
- The MIDI adapter connects to all input ports. There is no port selection and no MIDI learn.
- After the first start, the `gilrs` HID thread stays for the life of the app (the macOS backend cannot stop it). The adapter discards its events while no graph uses a gamepad.
- The note, velocity, and raw Control Change outputs use the `number` port type. They move to `integer` after the W0 value model.
