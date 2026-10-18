# Blueprint input devices analysis (slice I)

Date: 2026-10-18. Bundle: B13 Blueprint depth ([plan](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md)). Issue: [#86](https://github.com/danirukun/opensekai/issues/86) (BP-06). Base: `opensekai/blueprint-depth` at `671e2f8`.

## Problem

Blueprints react only to the keyboard. On Keystroke Pressed uses OS hotkeys, and Is Key Held and Key Axis use a listen-only event tap ([continuous contract](../prompt/2026-10-12-continuous-blueprints.md)). A VTuber also uses a gamepad, a MIDI controller (pads, keys, knobs, and faders), and the mouse pointer to drive a show. Warudo has the palette categories Input (10 nodes) and MIDI (5 nodes) ([node audit](../../docs/evaluation/blueprint-node-audit.md)). OpenSekai has no gamepad, MIDI, or pointer node.

## Decisions

- **One device path next to the key path.** The host has a device hub with one adapter for each device kind: `gamepad`, `midi`, and `pointer`. Each adapter is behind the `DeviceAdapter` trait. The hub starts an adapter only while an enabled graph has a node of that kind. The session reports the kinds in the same reply fields that carry the held-key set (`devices` next to `heldKeys`). The clock carries device events and device state in a new `devices` field of `InputUpdate`.
- **Gamepad: `gilrs` 0.11.2.** It is the standard Rust gamepad crate. It has macOS (IOKit HID), Windows (Windows.Gaming.Input), and Linux backends and the SDL mapping database. It reads the pad when the app does not have focus. Alternative: Apple Game Controller framework. It needs Objective-C bindings and `shouldMonitorBackgroundEvents`, and it gives no Windows path. Rejected for this slice.
- **Gamepad identity: player slot 1 to 4.** The host gives each connected pad the lowest free slot and keeps the slot until the pad disconnects. A node selects Any pad or one slot. A stable hardware ID needs a device picker with a live device list. That is a later change. Most operators use one pad.
- **The macOS `gilrs` backend cannot stop its HID thread.** Drop of a `Gilrs` value leaves its run loop thread and its HID manager open. A second `Gilrs` value makes a second thread. So the host makes one `Gilrs` value at the first start and keeps it. While no graph uses a gamepad, the adapter thread reads and discards the events, so the event channel cannot grow. It keeps no gamepad state and sends nothing.
- **Dead zones in the host.** Sticks use a radial dead zone of 0.15 and rescale the rest to 0 to 1. Triggers use a dead zone of 0.05. Stick Y is positive up. These are pure functions with unit tests.
- **MIDI: `midir` 0.11.1.** It uses CoreMIDI on macOS and WinMM on Windows. The adapter connects to all MIDI input ports. A node filters by channel (Any or 1 to 16). Operators usually have one controller, and a port picker needs a live device list. The adapter scans the port list each 2 s and connects new ports. A port that goes away closes its connection. Errors from a scan or a connect do not stop the adapter.
- **CoreMIDI needs a run loop.** CoreMIDI updates the source list on the run loop of the thread that made the first client. The MIDI adapter thread makes the first client and runs its run loop in slices of 0.25 s while it is active. The thread stays alive after the first start and waits on a condition variable while it is not active, so the run loop that holds the notifications is not lost.
- **MIDI Control Change is state.** The host keeps the last value of each controller and sends only the changed values on each clock. A knob that sends 200 messages a second therefore gives at most one value for each clock. The session keeps the last value of each channel and controller. Before the first message, the value is 0.
- **Pointer: polling, no new permission.** On macOS the host reads the pointer location with `CGEventCreate` and `CGEventGetLocation`, the main display bounds with `CGDisplayBounds`, and the buttons with `CGEventSourceButtonState`, once for each clock. These calls need no permission. A pressed event is an edge between two clock reads. The button-down counters (`CGEventSourceCounterForEventType`) also show a click between two reads, so a trackpad tap shorter than one clock is not lost. A listen-only tap would see every click, but it needs Input Monitoring. Rejected for this slice.
- **Pointer position is normalized to the main display.** X goes from 0 at the left edge to 1 at the right edge. Y goes from 0 at the top edge to 1 at the bottom edge. A pointer on another display gives a value out of 0 to 1. Pixels differ between Retina and other displays. A normalized value maps directly to a look direction.
- **Linux and other platforms report `UNSUPPORTED`.** `gilrs` on Linux needs udev headers and `midir` needs ALSA headers. The Linux cloud baseline has neither, so the crates are target dependencies for macOS and Windows only. The pointer adapter is macOS only in this slice. Windows uses `GetCursorPos` in a later slice.
- **Event data comes from the trigger.** On MIDI Note On gives `note` and `velocity` from the event that started the run, as On Update gives `deltaSeconds`. Outside that run (for example after a Delay) the values are 0.
- **Ports.** All number outputs use the `number` port type. Note, velocity, and the raw controller value are integers. They move to the `integer` port type when the W0 value model is merged.

## Rejected approaches

- One event per raw HID or MIDI message on the clock: a stick or a knob makes hundreds of messages a second. The clock limit is 16 keystroke events.
- A device list call and pickers for each device: needs a new call and live UI. The slot and the all-ports decision cover one pad and one controller.
- A tap for pointer clicks: needs Input Monitoring for a feature that polling covers.
- New `Gilrs` value on each start: leaks one thread and one HID manager for each start on macOS.

## Effects

- A graph with On Gamepad Button Pressed runs when the operator presses the button while another app has focus.
- Gamepad Axis gives the stick value in On Update, so a stick can move a character with Move Entity.
- On MIDI Note On runs with the note and velocity. MIDI Control Value follows a knob or fader.
- Pointer Position follows the mouse. On Pointer Button Pressed runs on a click in any app. The click still reaches that app.
- When a graph with a device node is disabled or removed, the host stops that adapter. A pointer adapter stops at once. A MIDI adapter closes its connections. A gamepad adapter discards events (see the `gilrs` decision).
- App status shows `UNSUPPORTED` for a used device kind on a platform without an adapter.

## Out of scope

Stable gamepad IDs and a device picker, MIDI port selection, MIDI learn, MIDI output, pitch bend, program change, aftertouch, rumble, pointer wheel, pointer buttons 4 and 5, the Windows pointer adapter, and Linux adapters.
