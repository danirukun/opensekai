# REASONS: Continuous Blueprints

Date: 2026-10-12. Scope: asset properties, On Update, global held-key input, Vector3 values, and a runtime override layer that commits when motion stops. Analysis: [continuous Blueprints](../analysis/2026-10-12-continuous-blueprints.md).

## R — Requirements

R1. The Blueprint port types are `flow`, `number`, `boolean`, and `vector3`. A `vector3` value is a tuple of three finite numbers. Like each other data input, a `vector3` input must be connected; the compiler rejects an unconnected one. A connection joins ports of the same type only. Variables stay `number` and `boolean`.
R2. The catalog has these Vector3 nodes in the category Math. **Make Vector3** (`vector3.make`): inputs `x`, `y`, `z` (number); output `value` (vector3). **Break Vector3** (`vector3.break`): input `value`; outputs `x`, `y`, `z`. **Add Vector3** (`vector3.add`): inputs `a`, `b`; output `result`. **Scale Vector3** (`vector3.scale`): inputs `value` (vector3) and `factor` (number); output `result`.
R3. A property registry in `@opensekai/contracts` lists the writable properties for each entity kind. Each entry has a key, a label, a value type, and a validation rule.
    - Entity kinds other than `tracking`: `position` (Position, vector3, metres, finite), `rotation` (Rotation, vector3, Euler degrees in YXZ order, finite), `scale` (Scale, vector3, each component greater than 0), and `visible` (Visible, boolean).
    - `camera` also has `fovDegrees` (Field of View, number, 1 to 179).
    - Rotation converts to and from the entity quaternion. A read gives angles in the range −180 to 180.
R4. **Get Asset Property** (`property.get`, category Scene): settings `{ entityId, property }`; output `value` with the registry type. It reads the evaluated scene (R10).
R5. **Set Asset Property** (`property.set`, category Scene): settings `{ entityId, property }`; inputs `flow` and `value` with the registry type; output exit. It writes an override (R10).
R6. **Move Entity** (`entity.move`, category Scene): settings `{ entityId, space: 'world' | 'local' }`; inputs `flow` and `delta` (vector3); output exit. It writes the override `position + delta`. In `local` space the session first rotates `delta` by the entity rotation.
R7. **On Update** (`event.update`, category Events): outputs `flow` and `deltaSeconds` (number). It fires once for each session advance in each enabled graph, after the keystroke events of that advance. `deltaSeconds` is the elapsed session time since the previous advance, clamped to 0 to 0.1. The first advance after a graph becomes enabled gives 0. The existing per-tick flow budget applies.
R8. **Is Key Held** (`input.keyHeld`, category Input): settings `{ code }`; output `held` (boolean). **Key Axis** (`input.keyAxis`, category Input): settings `{ negative, positive }`; output `value` (number): −1 when only the negative key is held, 1 when only the positive key is held, else 0. A code is a DOM `KeyboardEvent.code` value from the existing keystroke code list. No modifier is required.
R9. The session computes the watched key set: the union of the codes in `input.keyHeld` and `input.keyAxis` nodes of enabled graphs. It sends the set to the native host each time it changes, in the same path as the accelerator list. The clock `InputUpdate` gains an optional `held` array of codes (at most 16) that lists the watched keys that are down. The `events` array becomes optional; an update has at least one of the two. The host adds `held` to a clock tick when at least one watched key is down. A clock without `held` means that no watched key is down. The session reports the watched set as `heldKeys` in the `blueprintEdit` result and in `blueprintInspect`, only when the set is not empty. The set has at most 16 codes; an edit that makes more is rejected.
R10. The session keeps an override layer: entity ID → property key → `{ value, lastWriteMs, graphIds }`, where `graphIds` lists the graphs that wrote the override since its last commit. Set Asset Property and Move Entity write to it. The session validates each value with the registry rule and with the scene schema of the entity after the write. An invalid value, or a write that makes more than 256 overrides, becomes the runtime error of the graph and is not stored. A write that does not change the current value (for example Move Entity with a zero delta while no key is held) changes nothing and keeps `lastWriteMs`, so an On Update graph that keeps running still lets its overrides commit. The evaluated scene is the persistent scene with the overrides applied. The frame scene, the tracking composer, and Get Asset Property use the evaluated scene.
R11. At each advance, after the Blueprint step, the session commits each override whose `lastWriteMs` is 250 ms or more before the current session time. All such overrides go into one scene patch (`setTransform`, `setVisibility`, and `setCameraLens` operations), applied without an expected revision. Then the session removes them. A failed commit removes the overrides and becomes a runtime error of each graph that wrote them. While no override commits, the scene revision does not change.
R12. A scene patch from the editor or MCP removes each override of a property that the patch changes. `sceneReplace` removes all overrides. Removal of an entity removes its overrides.
R13. The native host has a `KeyMonitor` adapter with `set_watched(codes)` and a held-key snapshot.
    - The macOS adapter uses a listen-only `CGEventTap` for key down and key up, on its own thread. The code list has no modifier keys, so modifier-flag events are not observed. It never changes or consumes an event. It starts when the watched set becomes non-empty and stops when the set becomes empty.
    - It checks `CGPreflightListenEventAccess`. Without access it calls `CGRequestListenEventAccess` once and reports held keys as empty.
    - When the tap is disabled (timeout or user input), it enables the tap again and clears the held set.
    - Other platforms report `UNSUPPORTED`.
R14. App status gains a warning while the watched set is not empty and the monitor cannot observe keys. Without access, the warning is `FORBIDDEN` with the message `Input Monitoring is off` and the ID `input-monitoring`. On an unsupported platform, the warning is `UNSUPPORTED` with the message `Held keys are unavailable on this platform` and the same ID. The Blueprint panel shows the warning. On macOS it has an **Open Settings** action that opens the Input Monitoring pane.
R15. The editor:
    - The node palette has the category **Input**.
    - New field kinds: `key` (a list of the keystroke codes, without the modifier rule; a capture field would arm the global capture, which unregisters all hotkeys), `property` (the registry entries for the kind of the selected entity), and `space` (World or Local).
    - The `value` port of Set Asset Property and Get Asset Property takes its type from the selected property. A property change that changes the type removes connections that no longer match.
    - `vector3` sockets have their own socket color.
R16. The `opensekai://blueprint-nodes` MCP resource also lists the property registry: kind, key, label, type, and validation rule.
R17. A saved show stores the committed values. It never stores overrides.

## E — Entities

- `PortType`: adds `vector3`. `BlueprintValue`: `number | boolean | [number, number, number]`.
- `AssetProperty`: `{ key, label, kinds, type: 'number' | 'boolean' | 'vector3', rule }`. `PROPERTY_REGISTRY`.
- Node types: `vector3.make`, `vector3.break`, `vector3.add`, `vector3.scale`, `property.get`, `property.set`, `entity.move`, `event.update`, `input.keyHeld`, `input.keyAxis`.
- Field kinds: `key`, `property`, `space`. Node category: `Input`.
- `InputUpdate`: `{ events?: KeystrokeEvent[]; held?: string[] }`, with at least one of the two.
- `BlueprintEffect`: adds `setProperty { entityId, property, value }` and `moveEntity { entityId, space, delta }`. The session resolves `moveEntity` against the current override, so two moves in one tick add up.
- Session `OverrideLayer`: `Map<EntityId, Map<PropertyKey, { value; lastWriteMs; graphIds }>>`. Not a protocol type.
- Native `KeyMonitor` trait; `MacKeyMonitor`; `UnsupportedKeyMonitor`.

## A — Approach

Change the contracts first, in TypeScript and Rust together: the port type, the registry, `InputUpdate`, and validation vectors. Then build the session override layer and On Update, the new nodes and evaluators, the native key monitor and its path to the clock, and the editor fields. Keep the override layer next to the Blueprint runtime in the session, and give the frame and tracking paths one evaluated scene. Keep the monitor behind a trait, so the Windows hook can replace the stub later.

## S — Structure

- `packages/contracts/src/blueprint-nodes/` (`define.ts`, a new `vector3.ts`, a new `properties.ts`, a new `input.ts`, `events.ts`, `scene.ts`, `index.ts`); `packages/contracts/src/property-registry.ts` (new); `packages/contracts/src/schema.ts`, `blueprint.ts`; `crates/contracts/src/lib.rs`; `fixtures/protocol/validation-vectors.json`.
- `packages/session/src/` — a new `overrides.ts`, `blueprint.ts`, `blueprint-runtime.ts`, `blueprint-eval/` (new evaluators), `session.ts`, `scene-ops.ts`.
- `apps/desktop/src-tauri/src/input.rs` and a new `input/monitor.rs` with `macos.rs`; `service/mod.rs` (watched set, clock `held`, status warning); `Cargo.toml`.
- `apps/mcp/src/resources.ts`.
- `apps/desktop/src/components/BlueprintNodeFields.svelte`, `BlueprintPanel.svelte`, the Rete socket styles, `blueprints/keystroke-format.ts`.
- `docs/warudo-parity.md` and an evaluation note.

## O — Operations

1. Contracts: the `vector3` port type, the property registry, the new node definitions, the field kinds, and `InputUpdate.held` in TypeScript and Rust. Add validation vectors and contract tests.
2. Session: the override layer, validation, the commit rule, removal on patches, replace, and entity removal. Add unit tests with a controlled clock.
3. Session: On Update, the Vector3, property, Move Entity, and input evaluators, the evaluated scene for frames and tracking, and the watched key set. Add unit tests.
4. Native: the `KeyMonitor` trait, the macOS event tap, the stub, the watched set path, `held` on the clock, and the status warning. Add Rust tests for the bookkeeping with a fake event source.
5. Integration: held keys from the native clock reach the session and move an entity, through the real process boundary. State why the test is an integration test.
6. Editor: the Input category, the new fields, typed `value` ports, socket color, and the warning action.
7. MCP: the registry in the node resource. Add a test.
8. Verify in the running macOS app: grant Input Monitoring, build the WASD graph, hold W while TextEdit has focus, and check that the character moves in the preview and the OBS output and that TextEdit receives the letters. Release, then check the Inspector, the scene revision count, and save and open. Record evidence and parity.

## N — Norms

Use `@oshi-connect/ui` controls. Keep UI copy to the labels and messages in R2 to R15. Write prose in ASD-STE100. Use pnpm. Keep functional TypeScript and plain data. Keep platform code behind the monitor trait.

## S — Safeguards

- The key monitor must never consume, change, or inject an event.
- Do not report, log, or store keys outside the watched set. Do not send key data over any channel other than the clock `held` array.
- Do not change the scene revision while overrides are written. Commit only under the R11 rule.
- Do not store overrides in a show document.
- A lost key up must not leave a key held: clear the held set when the tap is disabled or the monitor stops.
- Do not change the modifier rule or the behavior of On Keystroke Pressed.
- Do not change the behavior of the existing persistent Scene nodes.
- Clamp `deltaSeconds` so that a stall does not move an entity a long distance.
