# Continuous Blueprints analysis

Date: 2026-10-12. Scope: the second Blueprint slice. Asset properties, On Update, held keys, and a runtime override layer. The reference case is a character that moves while the operator holds W, A, S, or D.

## Problem

A Blueprint can toggle visibility and switch cameras. It cannot change other properties of an asset. It also cannot run continuously, and it cannot read a held key:

- On Keystroke Pressed fires once for each press. Nothing reports that a key is held.
- Keystrokes use OS-registered global hotkeys. OpenSekai holds a registered combination, and other apps do not receive it. Each accelerator must therefore contain Control, Alt, or Meta ([interactions analysis](2026-10-07-blueprint-interactions.md)). W, A, S, and D alone cannot be hotkeys.
- Each Blueprint effect is a persistent scene patch. A graph that writes the scene 60 times a second changes the scene revision on each tick, and each editor edit then gets a revision conflict. The interactions slice deferred On Update for this reason.

Warudo uses one pattern for continuous interaction: On Update reads an input, math nodes map it, and **Set Asset Property** writes a property of an asset ([pen display hand sync](https://docs.warudo.app/docs/blueprints/templates/pen-display-hand-sync)). Its keyboard input does not block other apps.

## Decisions

- **Global pass-through key input.** A native key monitor observes key down and key up in all apps and never consumes a key. On macOS it is a listen-only event tap. It needs the Input Monitoring permission. Windows uses a low-level keyboard hook in a later slice; until then the Windows adapter reports `UNSUPPORTED`.
- **Watched keys only.** The monitor reports only the keys that enabled graphs read. It runs only when that set is not empty. It never streams other keystrokes.
- **Warudo-shaped properties.** Get Asset Property and Set Asset Property use a typed property registry. A property is a whole value: Position is a Vector3. A new `vector3` port type carries it.
- **Runtime overrides that commit when motion stops.** Property writes from Blueprints go to an override layer in the session. Renderers and the tracking composer read the scene with overrides applied. The scene revision does not change during motion. When an override has had no write for 250 ms, the session commits it to the persistent scene in one patch. The Inspector and Save then show the new value.
- **Explicit edits win.** An editor or MCP patch that changes an overridden property removes that override.
- **Existing nodes do not change.** On Keystroke Pressed keeps its modifier rule. Set Visibility, Toggle Visibility, and Switch Camera stay persistent effects.

## Rejected approaches

- Focused-window key input: movement stops when another app has focus. The operator wants the keys to work while a game, OBS, or chat has focus.
- Registered hotkeys with a release event: the keys would need a modifier and would be held from other apps.
- Runtime-only overrides that never save: the operator wants the moved position to stay.
- One node type for each property: each new property would need a new node, evaluator, and editor field.
- Scalar property paths without Vector3: the shapes would differ from Warudo templates.

## Effects

- A WASD graph moves a character in the preview and in the OBS output while another app has focus. That app still receives the letters.
- The scene revision increases by one each time movement stops, not on each tick.
- The Inspector shows the committed value. During motion it shows the value from before the motion.
- The first use of a held-key node on macOS asks for the Input Monitoring permission. Without it, held-key nodes read false and the Blueprint panel shows a warning.
- macOS secure input (for example a password field) hides keys from the event tap. Held keys are then cleared, so a character does not continue to move.

## Out of scope

Mouse position and other pointer input, IK and anchors (CHR-06, ENV-06), easing and tweened property actions, properties other than the registry entries in this slice, Vector3 variables, Windows key monitoring, gamepad and MIDI input, and changes to On Keystroke Pressed.
