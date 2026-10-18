# REASONS: Blueprint input devices (slice I)

Date: 2026-10-18. Scope: gamepad, MIDI, and pointer triggers and values for Blueprints (BP-06 partial). Analysis: [input devices](../analysis/2026-10-18-blueprint-i-input-devices.md). Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md). Issue: [#86](https://github.com/danirukun/opensekai/issues/86).

## R — Requirements

R1. Device kinds are `gamepad`, `midi`, and `pointer`. The session computes the used kinds: the kinds of the device nodes in enabled graphs that compile. It reports them as `devices` (sorted, unique, 1 to 3 entries) in the `blueprintEdit` result and in `blueprintInspect`, only when the list is not empty. The host keeps the list with the held-key set and uses the same rules for a new publisher, a reconnect, and a disconnect ([continuous contract](2026-10-12-continuous-blueprints.md) R9).
R2. The native host has a device hub with one adapter for each kind, behind the `DeviceAdapter` trait (`kind`, `set_active`, `collect`, `status`). The hub activates an adapter while its kind is in the list and a publisher is connected. Otherwise the adapter is not active. An adapter that is not active sends nothing and keeps no device state.
R3. The clock `InputUpdate` gains an optional `devices` object. An update must have at least one of `events`, `held`, and `devices`. `devices` has at least one of these fields:
    - `events`: 1 to 32 device events, in arrival order.
    - `gamepads`: 1 to 4 pad states `{ pad, buttons?, axes? }`. `pad` is the slot 1 to 4, unique in the list. `buttons` lists 1 to 17 unique held buttons. `axes` has the non-zero values of `leftX`, `leftY`, `rightX`, `rightY` (−1 to 1) and `leftTrigger`, `rightTrigger` (0 to 1). The host sends a pad only when a button is held or an axis is not zero. A missing pad has no held button and all axes at 0.
    - `pointer`: `{ x, y, buttons? }`. `x` and `y` are finite and in −16 to 16. `buttons` lists 1 to 3 unique held buttons. The host sends `pointer` on each clock while the pointer adapter is active.
    One named rule sets the clock byte limit on both sides: `clockByteLimit` (TypeScript) and `clock_byte_limit` (Rust). A clock with `tracking` or with `input.devices` has the 64 KiB limit, because tracking samples, and 32 device events with 4 pads, exceed the plain 2 KiB limit. Any other clock has the 2 KiB limit. Shared vectors check both limits. The largest valid device clock is less than 16 KiB.
R4. Device events:
    - `{ kind: 'gamepadButton', pad, button, pressed }`.
    - `{ kind: 'midiNote', channel, note, velocity, on }`. `channel` is 1 to 16. `note` and `velocity` are 0 to 127.
    - `{ kind: 'midiControl', channel, controller, value }`. `controller` and `value` are 0 to 127.
    - `{ kind: 'pointerButton', button, pressed }`.
    Gamepad buttons: `south`, `east`, `west`, `north`, `leftBumper`, `rightBumper`, `leftTrigger`, `rightTrigger`, `select`, `start`, `mode`, `leftStick`, `rightStick`, `dpadUp`, `dpadDown`, `dpadLeft`, `dpadRight`. Pointer buttons: `left`, `right`, `middle`.
R5. Both sides validate the new fields (zod in `@opensekai/contracts`, serde and `validate` in `crates/contracts`). Shared vectors in `fixtures/protocol/validation-vectors.json` cover a valid clock with devices and invalid ones.
R6. The host queue keeps device events in arrival order, at most 128, and drops the oldest when it is full. Each clock takes at most 32 events; the rest stays for the next clock. A MIDI Control Change replaces the pending value of the same channel and controller and moves to the back of the queue. So a fast knob gives one value for each clock, the order follows the last arrival, and the session's any-channel value is the latest value.
R7. Gamepad adapter (`gilrs` 0.11.2, macOS and Windows):
    - It assigns each connected pad the lowest free slot 1 to 4 and frees the slot on disconnect. A fifth pad gets no slot and is ignored.
    - On disconnect, it queues a released event for each button that the pad reported held, before it frees the slot.
    - A button press and a release become `gamepadButton` events. A repeat is ignored.
    - Sticks use a radial dead zone of 0.15 and rescale the remainder to 0 to 1. Triggers use a dead zone of 0.05 and rescale the remainder. Stick Y is positive up.
    - The host makes one `Gilrs` value at the first activation and keeps it for the life of the process. Its thread waits for events with a 100 ms timeout, then takes all pending events (at most 1024), reads the pads once, and takes the state lock once for each wake. While not active, it discards events.
    - A failed thread spawn gives `UNAVAILABLE`; a later spawn that succeeds clears it. A thread that panics gives `UNAVAILABLE` and is not started again, because a second `Gilrs` value would leak another HID thread.
R8. MIDI adapter (`midir` 0.11.1, macOS and Windows):
    - It connects to all input ports. Each 2 s while active it scans the ports, connects new ones, and drops connections to ports that are gone. Each port is tried on its own; a port that fails to connect is tried again at the next scan, and the other ports still connect. The adapter is `UNAVAILABLE` only when no MIDI client can be made, or when ports exist and none is connected. A thread that panics gives `UNAVAILABLE`.
    - A Note On with velocity 0 is a Note Off with velocity 0. System, SysEx, and other channel messages are ignored. A message with a data byte above 127 or with too few bytes is ignored.
    - It runs on one thread that lives after the first activation. While active, the thread runs its run loop in slices of 0.25 s (macOS) or sleeps 0.25 s (other platforms). While not active, it closes all connections and waits on a condition variable.
R9. Pointer adapter (macOS):
    - On each clock while active, it reads the pointer location (`CGEventCreate`, `CGEventGetLocation`), the main display bounds (`CGDisplayBounds(CGMainDisplayID())`), the left, right, and middle button state (`CGEventSourceButtonState`), and the left, right, and other button-down counters (`CGEventSourceCounterForEventType` with `kCGEventLeftMouseDown`, `kCGEventRightMouseDown`, `kCGEventOtherMouseDown`), all in the combined session state. It needs no permission.
    - `x = (location.x − bounds.x) / bounds.width`, `y = (location.y − bounds.y) / bounds.height`, clamped to −16 to 16. Origin top left, Y down.
    - A button that is down now and was up at the previous read gives `pointerButton` pressed. The opposite gives released. A down counter that changed shows a click between the two reads: up then up gives pressed and released (for example a trackpad tap shorter than one clock), down then up gives released, pressed, released, and down then down gives released and pressed. Two or more clicks of one button between two reads count as one. The first read after activation gives no events.
R10. The Blueprint panel shows these warnings in the same place as the Input Monitoring warning, with the message only. App status gains one warning for each used device kind whose adapter is `UNSUPPORTED` (no adapter on the platform) or `UNAVAILABLE` (the adapter failed to start), while a publisher is connected. IDs: `device-gamepad`, `device-midi`, `device-pointer`. Messages: `Gamepad input is unavailable`, `MIDI input is unavailable`, `Pointer input is unavailable`.
R11. Session: each clock replaces the gamepad and pointer state. MIDI Control Change values update a map of the last value for each channel and controller, and for each controller on any channel. The map lasts for the session. `gamepadButton`, `midiNote`, and `pointerButton` events start runs in arrival order, after keystroke events and before On Update.
R12. Nodes (category Input; port types `flow`, `number`, `integer`, `boolean`). The integer outputs widen into number inputs (value model rule). No node has a data input, so no inline input default applies:
    - **On Gamepad Button Pressed** (`gamepad.pressed`) and **On Gamepad Button Released** (`gamepad.released`): settings `{ pad: 0..4, button }`, 0 means any pad; output `flow`.
    - **Is Gamepad Button Held** (`gamepad.held`): settings `{ pad, button }`; output `held` (boolean).
    - **Gamepad Axis** (`gamepad.axis`): settings `{ pad, axis }`; output `value` (number). With any pad, the value with the largest magnitude.
    - **On MIDI Note On** (`midi.noteOn`) and **On MIDI Note Off** (`midi.noteOff`): settings `{ channel: 0..16, anyNote: boolean, note: 0..127 }`, channel 0 means any; outputs `flow`, `note`, `velocity` (integer). The data outputs read the event that started the run; otherwise 0.
    - **MIDI Control Value** (`midi.control`): settings `{ channel, controller: 0..127 }`; outputs `value` (number, 0 to 1) and `raw` (integer, 0 to 127). 0 before the first message.
    - **Pointer Position** (`pointer.position`): outputs `x`, `y` (number). 0 while the clock has no pointer state.
    - **On Pointer Button Pressed** (`pointer.pressed`): settings `{ button }`; output `flow`.
    - **Is Pointer Button Held** (`pointer.held`): settings `{ button }`; output `held` (boolean).
R13. The editor shows the settings with a new field kind `choice` (a fixed list of options) for pad, button, axis, channel, and pointer button, the `integer` kind of the value model for note and controller, and the existing `boolean` kind for Any note.
R14. Each new node type has a row in `docs/evaluation/blueprint-node-audit.json` with `evidence: "tests"`.

## E — Entities

- `DeviceKind`: `'gamepad' | 'midi' | 'pointer'`. `GamepadButton`, `GamepadAxis`, `PointerButton` enums.
- `DeviceEvent`, `GamepadSnapshot`, `PointerSnapshot`, `DeviceUpdate` (`packages/contracts/src/devices.ts`, Rust mirror in `crates/contracts`).
- `InputUpdate`: `{ events?; held?; devices?: DeviceUpdate }`.
- `blueprintEdit` result and `BlueprintInspect`: optional `devices: DeviceKind[]`.
- `BlueprintField`: adds `{ kind: 'choice'; options: { value: string | number; label: string }[] }`.
- Node types: `gamepad.pressed`, `gamepad.released`, `gamepad.held`, `gamepad.axis`, `midi.noteOn`, `midi.noteOff`, `midi.control`, `pointer.position`, `pointer.pressed`, `pointer.held`.
- Session: `DeviceEnv { gamepads, pointer, midi }` in `RunEnv.devices`, the starting event in `RunEnv.trigger`. Runtime event `{ kind: 'device'; event }`.
- Native: `DeviceAdapter` trait, `DeviceStatus` (`Active`, `Idle`, `Unsupported`, `Unavailable`), `DeviceHub`, `DeviceQueue`, `PadSlots`, the MIDI decoder, dead-zone functions, pointer normalization and button edges.

## A — Approach

Extend the input contract first in TypeScript and Rust with shared vectors. Then add the session device state, the node definitions and evaluators in new family files, and the device dispatch in the runtime. Then add the native hub, its watched-kind path through the service (the same path as the held-key set), and the three adapters. Keep the decoding and mapping in pure functions with unit tests, and keep each OS API behind the adapter trait. The integration test drives the real service WebSocket with a fake adapter.

## S — Structure

- Contracts: `packages/contracts/src/devices.ts` (new), `schema.ts` (`InputUpdateSchema`, results, clock size rule), `types.ts`, `index.ts`, `blueprint-nodes/devices.ts` (new), `blueprint-nodes/index.ts` (one import and one array entry), `blueprint-nodes/define.ts` (append `choice`); `crates/contracts/src/devices.rs` (new), `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`.
- Session: `packages/session/src/devices.ts` (new), `blueprint-eval/devices.ts` (new, with a `RunEnv` augmentation), `blueprint-eval/index.ts`, `blueprint-runtime.ts` (device event, `devices()`), `blueprint-store.ts`, `session.ts` (clock ingest).
- Native: `apps/desktop/src-tauri/src/input/devices.rs` (new hub, queue, trait) with `input/devices/{gamepad,midi,pointer}.rs` (new); `input.rs`; `service/mod.rs`, `service/router.rs`; `bootstrap.rs` (installs the platform hub); `Cargo.toml`, `Cargo.lock`, `docs/dependencies.md`; `tests/device_input_integration.rs` (new).
- Editor: `apps/desktop/src/components/BlueprintNodeFields.svelte` (the `choice` field).
- Evidence: `docs/evaluation/blueprint-i-input-devices.md`, `docs/evaluation/blueprint-node-audit.json`.

## O — Operations

1. Contracts: device schemas, `InputUpdate.devices`, result `devices`, Rust mirror, vectors. Tests on both sides.
2. Session: device state, evaluators, runtime dispatch, used kinds in the store. Unit and session tests.
3. Native: hub, queue, pure decoders, adapters, service path, status warnings. Rust unit tests and one integration test through the service WebSocket.
4. Editor: the `choice` field.
5. Evidence note with the macOS steps for a real gamepad, MIDI controller, and mouse.

## N — Norms

Use pnpm, functional TypeScript, Zod 4, Vitest, Svelte 5, and `@oshi-connect/ui`. Write prose in ASD-STE100. Keep UI copy to node labels, field labels, and option labels. Keep each OS API behind `DeviceAdapter`. Pin new crate versions. Do not edit `docs/warudo-parity.md` or `ARCHITECTURE.md` (the integrator applies the report).

## S — Safeguards

- An adapter never consumes, changes, or injects an event. The pointer adapter only reads state.
- The host sends no device data while no enabled graph uses that kind, and no data on a channel other than the clock `devices` field.
- No busy loop: the gamepad thread blocks with a timeout, the MIDI thread runs its run loop or sleeps in slices, and the pointer adapter reads only on a clock.
- A disconnect of a pad or a MIDI port while active must not stop or crash the adapter.
- A lost release must not leave a button held: gamepad and pointer held state are snapshots on each clock.
- Do not create a second `Gilrs` value.
- Do not change On Keystroke Pressed, Is Key Held, Key Axis, or the key monitor.
- The clock stays within its byte limit: at most 32 device events and 4 pads.
