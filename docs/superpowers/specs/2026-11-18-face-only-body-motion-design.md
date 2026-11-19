# Face-only body motion design

Date: 2026-11-18. Status: draft for owner review.

## Intent

A performer who uses only face tracking (iFacialMocap, OpenSeeFace, FaceKit, or a webcam with upper body off) gets a moving head on a still body. Warudo makes the whole body move in a lifelike way from the head alone. OpenSekai must do the same, and the user must see and change how it works in a Blueprint graph.

## Reference: what Warudo does

Read from Warudo 0.15.1 in the VMPal QA VM on 2026-11-18, scene "RORO Compare", through the editor REST API (`/api/openedScene`) and a UI pass. The scene uses iFacialMocap. Warudo MediaPipe values were not read.

Warudo makes face-only motion from four layers:

1. A motion-captured idle clip on the character (`AGIA_Idle_cat_01`). Tracking replaces only the head and face.
2. Body rotation from the head, on the tracker asset: Body Rotation Type Inverted, intensity 0.5, direction (0.5, 1, 0.5), neck compensation 0.75, chest 0.25, spine 0.5, hips 0, delay 0, smoothing 0. Head Movement Intensity 2 on each axis, Maximal Head Translation 0.5 m, Body Movement Intensity 0.5.
3. Pendulum physics, on the tracker asset. On by default in Warudo; off in the RORO Compare scene. Pendulum Physics Intensity 0.5 (the class default). Four presets:

| Preset | Inputs (weight, scale, other) | Pendulum arms | Outputs (rotation, degrees per unit) |
|---|---|---|---|
| Arm Movements | head rotation X (0.33, ×20); head rotation Y (0.33, ×20, absolute value); head position Z (0.5, ×20); no input clamp (Clamp Override off); input smoothing 0.1 s | 4 arms, each length 10, mass 0.25, drag 0.25, spring 0.5, damping 0.5, gravity 1 | right shoulder Z +2 (offset +5°); left shoulder Z −2 (offset −5°); right upper and lower arm Z +2; left upper and lower arm Z −2; right hand Z +10; left hand Z −10 |
| Finger Movements | same as Arm Movements | same as Arm Movements | 12 right finger bones Z +10; 3 right thumb bones Y +10; 12 left finger bones Z −10; 3 left thumb bones Y −10 |
| Body Lean | head position Z (1.0, ×5, clamp 0..1.5); input smoothing 0.4 s | none | spine X +45; neck X −15; head X −40 |
| Blink Receptors | eyeBlinkLeft and eyeBlinkRight (0.5 each, ×1) | 2 arms as above | none (the preset has no output in Warudo) |

4. The generated face blueprint: smoothing (blend shapes 0.2 s, rotations and root position 0.6 s), a 0.4 s fade to neutral and a 2 s fade to the idle head animation when tracking is lost, and a slow look-at-camera layer.

The raw values are in [the Warudo face reference](../../evaluation/warudo-face-reference/README.md). In Warudo, a pendulum input has a clamp (default −1..1). Warudo applies it after the scale, and only when Clamp Override is on. The template uses the node limit (−100..100) where Clamp Override is off. A head rotation input is the head angle in degrees ÷ 180. A head position input is the iFacialMocap translation × Head Movement Intensity (2), clamped to ±Maximal Head Translation (0.5). The reference README has the measurement (2026-11-19).

Warudo body rotation type Inverted: the body turns in the same direction as the head on X and Y, and in the opposite direction on Z. Warudo replaced its own Upper Body Rotation blueprint with this built-in feature in 0.12.0.

## Goals

- G1. A Blueprint template, "Face-Only Body Motion", for one character. It makes the body follow the head, makes the body lean, and makes the arms, hands, and fingers sway, from a face source only.
- G2. Each layer is visible and editable in the graph. The default values come from the Warudo reference table above.
- G3. The tracking setup guide adds the template when the user assigns a face source and no body source to a character. The Templates menu and MCP can also add it.
- G4. The motion stops smoothly when tracking is lost and starts smoothly when tracking is found.

## Non-goals

- N1. Imported idle clips (CHR-04). The template works on top of the current procedural idle (`packages/session/src/idle.ts`).
- N2. Moving tracking smoothing, mapping, or calibration into the graph. They stay in the tracker settings and the compose step.
- N3. The look-at-camera layer and the idle head animation (blink, look around) of the Warudo blueprint. They are a separate slice.
- N4. Moving the character root or head position from the head position (Warudo Head Movement Intensity and root position override).
- N5. Blink Receptors. It has no output in Warudo.
- N6. Pendulum profiles that save and load by name (the TRK-06 UI audit item).

## Anti-goals

- The change must not change the tracking compose path or invalidate its evidence (TRK-01, TRK-02, TRK-04, TRK-05, TRK-07).
- The template must not move a body that a body source (VMC, MediaPipe upper body) already drives.
- The graph must not lower the concert benchmark result.
- Do not copy Warudo code. Make the pendulum model from the observed parameters and the observed behavior.

## Constraints

- The session worker is the one authority (ARCHITECTURE.md). The graph runs in the session, on the session clock.
- Bone offsets: Euler degrees in the pose frame, order YXZ. A later write on the same bone turns the bone in the parent frame of the earlier write (`writeBoneOffset`). `previousPose` does not include offsets, so a graph that reads the head and writes offsets has no feedback loop.
- A show holds at most 8 graphs (`MAX_GRAPHS`). The template uses one graph for each character.
- A stateful node keeps plain data in `RunState.nodes` (`NodeState`). It must not change a stored object.
- MCP uses the same validated command API as the editor (template import through `importBlueprint`).
- Motion must continue when the editor is minimized.
- Tests: unit tests for new function behavior (pendulum step, input mixing, bone output mapping). Integration and headless editor checks at real boundaries. A macOS check with a real face source, the Catboy avatar, and the OBS output.

## Approaches

1. Full Warudo copy. Add list value types (blend shape list, bone rotation list) and move tracking application into a generated graph. Closest to Warudo, and all of it is editable. Rejected for now: it rewrites the one tracking authority and its evidence, adds a per-frame cost for each channel, and is about twice the size.
2. **Graph on top of the compose step (selected by the owner).** The compose step stays. A generated graph reads the tracked head and writes bone offsets. New nodes: a stateful Pendulum node, an Offset Bones output node, and a tracked head position input. The existing Smooth Damp nodes and tracking events supply the smoothing and the fade. Trade-off: tracking smoothing stays a tracker setting, not a node.
3. One node with all the Warudo settings. Rejected: it is in a graph, but the user cannot see or rewire its parts.

## Design

### New data: tracked head position

- The iFacialMocap parser keeps the head translation (values 4 to 6 of the `head#` field) in a new optional sample field `headPosition`. The MediaPipe face path keeps the translation of the face matrix in the same field. The compose step copies it into a new optional `AvatarPose.headPosition`.
- It is not a bone position: the renderer applies the `position` of a normalized bone, so a head bone position would move the head. The renderer and the VMC send pose do not read `headPosition`. (Changed in planning, 2026-11-18.)
- Calibrate also captures the neutral head position. The graph reads the head position relative to that neutral, in meters, in the pose frame. With no calibration, the head position input is 0.
- OpenSeeFace and FaceKit give no head position in this slice. Their head position input is 0, so Body Lean and the position part of the arm sway do nothing for them. The node Inspector does not need to state this; the parity entry records it.

### New nodes

- `tracking.getHeadPose` (data). Settings: character. It reads the composed pose of the previous tick, through the current face source of the character (the face source, else the body source, as in the compose step). It does not keep a source id. Outputs:
  - `rotation`: vector3, Euler degrees (pitch, yaw, roll), the same values as `character.getBoneRotation` on `head`. This includes calibration, the head intensity and offset, smoothing, and the compose fade on loss.
  - `position`: vector3, meters from the calibrated neutral. Zero with no calibration or no head position.
  - `tracked`: number, the compose weight of the face source (1 while it receives, falls to 0 in the compose stale fade, 0 with no face source).
- `tracking.pendulum` (data, stateful; palette category Tracking). Settings:
  - `inputs`: a list of 1 to 8 entries. Each entry: `kind` (head pitch, head yaw, head roll, head position X, Y, Z, or an ARKit blend shape name), `weight`, `scale`, `absolute`, and `clamp` (min, max). A new input is head yaw, weight 1, scale 5, clamp −100..100 (`PENDULUM_DEFAULT_INPUT`: the Warudo default with Clamp Override off, 2026-11-19). Each input is scaled, made absolute when set, and clamped, then multiplied by its weight; the node adds the results. The node reads the inputs from the same composed pose as `tracking.getHeadPose`. The unit of each head input is set by the Warudo measurement in "Left to the builder", so the Warudo scale values keep their meaning.
  - `inputSmoothing` (seconds).
  - `arms`: a list of 0 to 4 links, each with `length`, `mass`, `drag`, `spring`, `damping`, `gravity`.
  - Input: `character`. Output: `value` (number).
  - Step: mix the inputs (sum of weight × scale × value, with absolute value and clamp), smooth the mix over `inputSmoothing`, then drive the arm chain with it. The output is the angle of the last link, in the input units. With no arms, the output is the smoothed mix.
  - The step uses the session `deltaSeconds`. It is stable for a step from 1 ms to 100 ms. A longer step is cut into steps of at most 16 ms. A step of 0 keeps the state.
  - The step is implicit (backward Euler) in the spring, damping, drag, and gravity terms, so the chain stays finite and bounded at each value that the schema accepts. The step uses a mass of at least 0.01; the schema can keep 0. A negative gravity acts as 0, because the model has no stable rest for a pull away from rest. (Final review, 2026-11-19: the explicit damping and drag diverged at damping 30, mass 0.25, 60 Hz, and at mass 0.)
  - The chain model is the builder's call (see "Left to the builder"). It must settle with no input and must not overshoot without bound.
- `character.offsetBones` (flow). Settings: character and one output group: `bones` (one or more humanoid bones), `axis` (X, Y, or Z), `intensity` (degrees for each unit), and `offset` (degrees). Inputs: `value` (number) and `weight` (number, 0..1, default 1). For each bone, it emits one `offsetBone` effect with an angle of `weight × (value × intensity + offset)` on the axis, clamped to ±360. The template uses one node for each Warudo output group. (Planning made this one group for each node, 2026-11-18, so the Inspector needs no nested list.)
- The pendulum `inputs` and `arms` lists use a new generic `rows` field kind (a table of rows with number, boolean, and choice columns). The `bones` setting uses a new `bones` field kind, like the `meshes` field.

All three nodes appear in the node palette and work in any graph, not only in the template.

### The template

`packages/contracts/src/blueprint-templates/face-only-body-motion.json`, with a builder function like `upperBodyRotationTemplate`. One On Update event runs these chains in order:

1. **Fade.** `tracking.getHeadPose` `tracked`, through a Smooth Damp with smooth time 2 s, gives `fade`. All outputs below use `fade` as their weight. The graph does not use `tracking.onFound` or `tracking.onLost`: they hold a source id, and `onFound` fires only after a loss.
2. **Body follows head.** `tracking.getHeadPose` rotation, multiplied by the direction (0.5, 1, 0.5), the intensity 0.5, and the Inverted signs (+1 on X and Y, −1 on Z), and spread over the bones: spine 0.5, chest 0.25, hips 0. The neck takes the compensation 0.75 in the opposite direction, so the head keeps most of its tracked world rotation. Each factor is a graph variable that the user can change.
3. **Body Lean.** A Pendulum with the Body Lean inputs and no arms, then Offset Bones: spine X +45, neck X −15, head X −40.
4. **Arm sway.** A Pendulum with the Arm Movements inputs and arms, then Offset Bones with the six Arm Movements outputs.
5. **Finger sway.** A Pendulum with the Finger Movements inputs and arms, then Offset Bones with the four Finger Movements outputs.

The Warudo Pendulum Physics Intensity (0.5) multiplies the value of each Pendulum (Body Lean, Arm Movements, Finger Movements) before its Offset Bones nodes. It is one graph variable, "Pendulum Intensity". It does not change the Offset Bones `offset` (the shoulder ±5°) or the body-follows-head chain. (Final review, 2026-11-19. Before this change, the lean and the sway were 2 times the Warudo value.)

The graph name is "Face-Only Body Motion". All values come from the Warudo table above.

Known difference (head position): Warudo multiplies the head translation by Head Movement Intensity (2) and clamps it to ±Maximal Head Translation (0.5) before the pendulum input. The template gives the calibrated `headPosition` to the pendulum without this stage. This is "Different" until the phone check finds the iFacialMocap translation unit; then the template can add the stage.

### Where the template is added

- The Templates menu lists "Face-Only Body Motion" when the show has a character. It replaces "Upper Body Rotation" (owner decision, 2026-11-18): the menu no longer lists Upper Body Rotation, and the guide does not add it. A saved show that has an Upper Body Rotation graph keeps it and it keeps working. The bundled file stays so that its tests and old imports still work. This follows Warudo, which replaced its own Upper Body Rotation blueprint in 0.12.0.
- The tracking setup guide adds it when the plan gives a character a face source and no body source, and the show has no graph named "Face-Only Body Motion" whose nodes target that character. A renamed copy can cause a second graph; this is accepted. The guide does not add it when the show already has 8 graphs; it adds no message for this (the Blueprint list already shows the limit). Cancel in the guide removes the graph that the guide added, with the rest of the guide changes.
- MCP gets a template option on the Blueprint import tool, with the same template builder and `importBlueprint` as the editor.
- When a body or fingers source is assigned later, the graph stays, and Offset Bones skips a bone when one of these is true:
  - the character has a body source, and the part of the bone (`bodyPartOf`) is in `trackedParts` (a character with no `body` group counts as all parts);
  - the bone is a finger bone, and the character has a fingers source or a body source.

  The rule uses the assignment, not the bones of the current sample. A face-only character has no body source, so no output is skipped.

## Verification

- Unit: pendulum input mixing, smoothing, settle with no input, step-size stability, zero step; Offset Bones angle and weight; head position relative to the neutral; iFacialMocap translation decode; MediaPipe translation; renderer ignores a head bone position.
- Integration: the template imports through `importBlueprint` with a valid catalog; the guide plan adds it for a face-only assignment and not for a body assignment; MCP adds it.
- Headless editor check: a mock face sample turns and leans the head; the spine, arms, and fingers get offsets; tracking lost returns the motion to rest. The body turn follows the head back to rest. The other motion returns to rest in about 2 s. No pop shows.
- macOS: the Catboy avatar, a real face source (iFacialMocap on a phone, or the webcam with upper body off), the WebGPU OBS output. Record the backend, quality profile, fixture revision, and commit. Owner look review side by side with Warudo in the VM with the same pendulum presets on.
- Concert benchmark: no regression in frame time.
- Motion continues with the editor minimized.

## Parity and documents

- TRK-06 (pendulum) becomes Partial, with the presets and the "Different" points (own pendulum model, nodes instead of tracker settings).
- BP-11 records that the body-follows-head chain of this template replaces the Upper Body Rotation template in the menu.
- ARCHITECTURE.md: the tracking path records the head position field and that the renderer does not apply it.
- An SPDD analysis and slice contract follow in `spdd/analysis/` and `spdd/prompt/`.

## Left to the builder

- The pendulum chain model: map length, mass, drag, spring, damping, and gravity to a damped-spring chain. Tune it by side-by-side comparison with Warudo in the VM. Record it as "Different".
- The unit of each pendulum head input (degrees, radians, or a normalized value) and the body rotation spread. Measure them in Warudo in the VM: with the owner's agreement, turn on pendulum physics for a short time while the phone sends, and read the input values that each preset header shows ("33% Head Rotation X a → b") and the bone rotations, through the editor API. Do not save the scene. Done 2026-11-19 for the inputs (see the reference README). The iFacialMocap translation unit and the body rotation spread stay open for the macOS check.
- Node categories, port names, and Inspector layout, within the UI kit and the constitution rules.
- The MediaPipe face matrix translation units and axes.
