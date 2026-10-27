# Camera animation example analysis

Issue: [#89](https://github.com/danirukun/opensekai/issues/89) (BP-09). Queue bundle B24. Mode: contract-first. This is slice 1 of BP-09. It covers the camera animation example only.

## Problem

BP-09 names three Warudo Blueprint tutorials: Karaoke Time, Dance Dance Dance, and Animating the Camera. Each tutorial is an example graph that an operator builds from nodes. OpenSekai has no example for any of them. The issue is a roadmap issue, not a task contract, so it needs a bounded slice first.

## Handbook recheck

The handbook was read on 2026-10-27.

- [Karaoke Time](https://docs.warudo.app/docs/blueprints/tutorials/karaoke): On Keystroke Pressed (M), Toggle Asset Enabled on a microphone prop that is attached to the left hand, Play Character Idle Animation (`010_0970`), Play Sound (a whoosh), Flip Flop, Load Animation Profile (a masked overlay animation on the left arm, weight 0.88), and Delay Control Flow (1 s) before the microphone hides.
- [Dance Dance Dance](https://docs.warudo.app/docs/blueprints/tutorials/dance): On Twitch Channel Points Redeemed (or On YouTube Super Chat Received, or On WebSocket Message Received), If Branch, String Equal (`Dance`), Play Character One Shot Overlay Animation, Get Random Character Animation, Switch On Integer, Generate Random Integer (1 to 3), Play Sounds, and Spawn Particle.
- [Animating the Camera](https://docs.warudo.app/docs/blueprints/tutorials/camera): Camera Orbit Character with Align Target With Main Camera, Transition Time, Transition Easing (InOutSine), and the **On Transition End** flow output. "Exit" fires when the movement starts. A loop from On Transition End back to the first node is rejected; the tutorial uses Define Function and Flow Function for the loop. The loop stops when the operator takes manual control of the camera. It also uses Field of View during the move, Set Asset Transform with Align Target With Asset in the Free Look mode, and Switch Main Camera with an optional fade.

## Existing material

- `packages/contracts/src/blueprint-nodes/properties.ts`: Set Asset Property (`property.set`) with Position, Rotation, Scale, Visible, Field of View, and other keys. It has an optional Transition (s) and Easing (B13 H, 31 DOTween names, `InOutSine` included). Its only flow output is `exit`.
- `packages/session/src/tweens.ts`: one property tween for each entity and property on the session clock. A scene patch that touches the property, an immediate write, a new tween to another target, a failure, or a change of the graph stops the tween. A running tween to the same target keeps running. The tween has no record of the node that started it, and its end has no effect on the graph.
- `packages/session/src/blueprint.ts`: `compileBlueprint` rejects an immediate flow cycle. The `exit` of Delay and Debounce is not counted, because it runs in a later run.
- `packages/session/src/blueprint-runtime.ts`: Phase 3 runs due delays, debounces, and timers by due time, then schedule order.
- Events (B13 D): On Enable, Emit Event, On Event, timers. Flow: Flip Flop, Delay, Branch, Switch On Integer, Random Integer. Scene: Toggle Visibility, Set Visibility, Switch Camera (a cut, no fade).
- `packages/contracts/src/blueprint-templates/` and `apps/desktop/src/blueprints/templates.ts`: one template, Upper Body Rotation. The Templates menu in `BlueprintList.svelte` is enabled only when the scene has an avatar (`templatesEnabled`).
- Inline input values (B13 G) are set with `setNodeInput`, with undo. They do not change the logic key, so a change does not reset a graph.
- The camera has a Control Mode (`navigation`: `none`, `freeLook`, `orbitCharacter`). An orbit camera follows its character unless its position is overridden (`overrides.ts`). Editor viewport navigation sends `scenePatch` on the camera transform.
- The Rust host checks only the shape of a connection port name (`port_ok`), so a new port name needs no Rust change.
- No audio path exists in any package. No animation clip other than the built-in idle exists (CHR-04 partial). No prop attaches to a bone. No streaming trigger exists (BP-07, bundle B25). No particle entity exists.

## Findings

1. The camera tutorial needs one missing runtime behavior: a flow output that runs when a transition ends. Set Asset Property already moves a camera with an easing. With an end output, the operator can chain moves and loop them.
2. A wire from an end output back to an earlier node is not an immediate cycle, because the end runs in a later run, as the `exit` of Delay does. OpenSekai can accept the direct loop. Warudo rejects it and needs a function. OpenSekai has no Blueprint function yet (BP-01 remains). The direct loop is more permissive than Warudo (Different).
3. The existing stop rules give the Warudo behavior "the loop stops when you take manual control": a viewport drag sends a scene patch on the camera transform, the patch stops the tween, and a stopped tween must not run its end output.
4. "Align Target With Main Camera" and "Align Target With Asset" copy the current pose into the node. Without that action, the operator must type each Vector3. An editor button that writes the current scene value of the target property into the inline `value` input with `setNodeInput` gives the same result, with undo, and does not reset the graph.
5. A template gives the operator a working example in one step, as Upper Body Rotation does for BP-11. The camera always exists (each output needs one), so the camera template does not need an avatar.
6. Karaoke needs audio playback, animation clips and profiles (CHR-04), and a prop attached to a hand bone. Dance needs streaming triggers (B25), one-shot overlay animations (CHR-04), audio, and particles. None of these exist. They are prerequisites, not example work. Karaoke and dance cannot be done in this slice.
7. Camera Orbit Character interpolates the orbit parameters (yaw, pitch, distance) around the character. Set Asset Property interpolates the world position along a line. A move between two points on one side of the character looks the same. A move to the far side passes closer to the character (Approximate). An orbit node is a separate slice with CAM-01.

## Questions resolved without the owner (reversible)

- **Slice scope.** Slice 1 is the camera example only. Karaoke and dance wait for their prerequisites (finding 6). Alternative: one contract for all three with stubs. Rejected, because the stubs would be claims without behavior.
- **End output on Set Asset Property only.** Set Expression, Toggle Expression, Set BlendShape, and Look At keep only `exit`. Alternative: an end output on each transition node. The camera example needs only Set Asset Property; the others can follow with the same rule.
- **Port name and label.** `transitionEnd`, label `On Transition End`, as in Warudo.
- **End without a tween.** When the write is immediate (no transition, 0 s, or a boolean property) or the value is already at the target, the end runs on the next step. Alternative: no end. Warudo runs the end after a 0 s transition, and a chain must not stop at a zero-length move.
- **End of a joined tween.** When the same target comes again during a running tween, the node joins it, and its end runs when that tween ends. Alternative: start a new tween. That changes the B13 H rule.
- **Direct loop.** Accepted (finding 2). Alternative: reject it as Warudo does. Rejected, because OpenSekai has no function node for the Warudo work-around.
- **Use current value.** A button on the Set Asset Property node in the editor. Alternative: an MCP tool. MCP already reads the scene and can send `setNodeInput`, so no new tool is necessary.
- **Template.** `Camera Sway`: two positions of the selected camera (or the camera of `output_main`), 3 s each, InOutSine, with a Field of View change, in a loop from On Enable. Alternative: an orbit to the back of the character, as in the tutorial. Rejected by finding 7 for this slice.

## Risks

- A loop with 0 s transitions runs once each step (60 times each second). It is bounded like a Delay of 0 s, but it does work on each tick. The flow budget of each run and the pending end limit bound it.
- The camera move on the OBS output, the look of InOutSine, and the frame pacing during a move need an owner check in OBS on macOS (`accept:local`).
- A tween owned by one graph can carry the end of a node in another graph. If the owner graph changes, the tween stops, and the other end does not run. This is the same as for the tween value today.
