# Live light editing analysis

Date: 2026-10-18. Scope: bundle B12 (#45 ENV-07). Contract: [live light editing](../prompt/2026-10-18-live-light-editing.md). Changes: [light entities](../prompt/2026-10-17-light-entities.md) R4, R8, R13, R14; [Warudo editor interactions](../prompt/2026-10-03-warudo-editor-interactions.md), the commit rule.

## Sources

- Owner QA of B9 on macOS, 2026-10-18. Findings: when the gizmo moves a light, the lighting and the shadows do not follow in real time. The light has no color picker ("use the native one if possible"). Most float properties use a step number input, and the owner wants sliders, so that a user can try values quickly. The direction is a Warudo-style stage with lights and real shadows. Spot, ambient, and haze lights are bundle B13.
- [Warudo Lights](https://docs.warudo.app/docs/assets/lights), read 2026-10-18. A transform gizmo moves and turns a light. The position of a directional light has no effect on its light.
- Owner decisions, 2026-10-18:
  - During a gizmo drag, both the Scene preview and the OBS output follow live. This applies to every gizmo drag, not only lights.
  - The slider and the color control are local components first. They move to `oshi-connect-ui` later.

## Current state

- **Gizmo drag.** `TransformControls` moves the root of the selected object (`editor-viewport.ts`). The renderer keeps that root on its draft pose while the drag continues (`frozen`). On release the viewport sends one `setTransform`, at the revision of the gesture start. A revision change during the drag cancels the gesture.
- **The root of a light is its editor helper.** The real three.js light is in the `owned` map of `createSceneLights` (`scene-lights.ts`). Each frame, `apply(frame.scene.entities)` puts that light at the saved transform. Thus during a drag only the helper moves, and the light and its shadow follow only after the release. OBS and the Editor window preview see only frames, so in those views every entity (avatars too) moves only after the release.
- **Directional position.** R4 puts the `DirectionalLight` at the origin − 50 m × the direction, and its target at the origin. The shadow camera is a fixed 20 m box at the origin (R8). Move is the default tool. Thus a move of a directional light has no visible effect.
- **Color.** The Inspector field is a kit text `Input` with `#rrggbb` validation. The kit has no color control, and its `Input` does not accept `type="color"`.
- **Float fields.** Light (Intensity, Range, Shadow Intensity, Bias, Normal Bias), Environment Reflections Intensity, Control Sensitivity, Expression Fade, and Tracking Smoothing (Min cutoff, Beta, Derivative cutoff) commit once on `change` or with Apply. The camera FOV commits with Apply. Only Transform has a live path: the scrub labels send one `setTransform` about every 16 ms through `createLiveTransform`, with at most one request in flight.
- **Camera navigation** already sends throttled commits during a gesture through `createNavigationCommitter`. The committer keeps the latest draft, sends at most one patch every interval and only after the previous reply, sends a last patch at the end, and can tell which frame revisions its own commits explain (`owns`).

## Decisions

These decisions are reversible.

1. **Live gizmo commits.** A gizmo gesture uses one navigation committer. It sends `setTransform` at most every 33 ms, and only after the previous reply. It sends a last commit on release when the end pose differs from the last pose it sent. A frame or a model revision that the gesture's own commits explain does not cancel the gesture. Any other revision cancels it. Reason: the owner wants OBS to follow live. The Inspector scrub already sends every 16 ms, so the route carries this rate. Alternative: only a local draft in the preview, and one commit on release.
2. **Local draft at frame rate.** Between two commits, the renderer that owns the gizmo draws the dragged entity from the gizmo pose. A light then moves with its helper at the preview frame rate, and its shadow too. Other renderers draw each committed pose.
3. **Cancel after a live commit.** Escape, pointer cancel, lost pointer capture, and focus loss are cancels by the user. A cancel after a commit was sent sends one more commit with the transform of the gesture start. Thus a cancel still leaves no edit. A foreign revision, a selection change, a disabled editor, or a tool change ends the gesture without a revert, because another edit now owns the scene.
4. **Settle.** After the last commit, the root stays on the committed pose until a frame with that revision or a later one arrives. Thus the object does not jump back for one frame.
5. **Directional position is the shadow focus.** The target of a directional light is the light position, and the light is 50 m back along the direction. The 20 m shadow box is then centered on the light position. Moving a directional light moves the area of its shadow. Its direction still comes from its rotation only, as in Warudo. The default light at `[2, 4, 3]` points at the origin, so the box center line goes through the origin, as before. The editor helper draws the shadow box outline when the shadow is on. Alternative: a box fitted to the camera view. That needs cascades or a fit rule and is a later choice.
6. **Native color picker.** The Color field has a native `<input type="color">` swatch next to the hex field. WKWebView opens the macOS color picker. While the user picks, the light changes live. The value is a lowercase `#rrggbb` string, which is the contract format, so the contract, Rust, the renderer, and MCP do not change.
7. **Sliders.** Each bounded float property of a scene entity in the Inspector is a live slider with a number field. A cubic curve gives fine control near zero for wide ranges (Intensity, Range, Tracking cutoffs). A soft slider end keeps a useful travel: for example, Intensity has a hard limit of 1000, and its slider ends at 10 (directional) or 100 (point). A typed value up to the hard limit is accepted, and the slider then stays at its end. The FOV becomes a live slider; Near and Far keep number fields with Apply. Tracking Smoothing loses its Apply button, because its sliders commit live. Reset stays.
8. **Not sliders.** Transform keeps its scrub labels. Blueprint node number fields keep number inputs: most of them are durations up to 3600 s, and they edit a Blueprint, not a scene entity. Blueprint variables and the clip planes have no bound.
9. **One generic live helper.** `createLiveTransform` becomes a wrapper around a generic `createLiveEdit`. The generic helper keeps the latest request, has at most one request in flight, waits 16 ms between sends, and checks the selection and the revision chain. The model flag `transformPending` becomes `livePending`, and each setter that a slider uses gets a `live` argument.
10. **Local controls.** `SliderField.svelte` and `ColorField.svelte` are local to `apps/desktop`, as constitution IX allows. They move to `oshi-connect-ui` after B13, which adds more users.

## Effects

- An operator drags a light and sees its light and shadow move at once in the preview, and in OBS about 30 times each second.
- A directional light can aim its shadow area at a stage that is not at the origin.
- An operator can pick a light color with the macOS picker and try values with sliders.
- Each live step is a scene revision, as the scrub path already makes.

## Risks

- Revision churn: about 30 revisions each second during a drag. The scrub path already makes about 60.
- WKWebView may fire `input` on a color change only when the picker closes. If so, the color changes on close. The macOS check records which.
- A drag that conflicts with a Blueprint override still shows the override, as before.
