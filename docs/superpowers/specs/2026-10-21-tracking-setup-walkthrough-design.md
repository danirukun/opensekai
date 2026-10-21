# Guided tracking setup for a character

Date: 2026-10-21. Status: draft for owner approval. Parity: TRK-23 ([#167](https://github.com/danirukun/opensekai/issues/167)), TRK-01, TRK-04, BP-05, BP-06.

## Intent

The owner wants to drive a character from a phone app such as SelfReflect or iFacialMocap. The setup must be automatic and pleasant. A guided walkthrough with an animated coach tells the performer what to do. The performer does the setup once for each app on a character. The result stays with the character in the show. When the show opens and the app sends data again, tracking works with no more steps.

Warudo does this job with "Setup Motion Capture", which generates Blueprints. Warudo needs those graphs because its receivers do not drive the character. In OpenSekai the character already binds its tracking sources, and the session composes them on each tick. Thus the walkthrough writes plain scene data: a tracking source, the character bindings, calibration, and face mapping. It does not generate a graph.

For flexibility, Blueprints get read access to tracking: new nodes read live tracked values and react to tracking events. The default tracking path never depends on a graph.

## Goals

1. A "Set up tracking" action on a Character opens a guide that is docked in the inspector column. The scene view stays visible at full size, so the performer sees the real character react.
2. The guide has five steps: Pick the app, Connect, Relax, Expressions, Try it.
3. Three app presets: SelfReflect (VMC), iFacialMocap, and a generic VMC app.
4. The Expressions step measures each ARKit channel and writes the input range for each channel to the face mapping of the source. A weak sender (for example, SelfReflect `jawOpen` peaks at 0.19) then drives the full blend shape.
5. An animated coach shows each move. The coach is a drawn face. ARKit channel values drive it.
6. The editor and MCP use the same validated command API for the setup.
7. New Blueprint nodes in a Tracking category: Get Tracking Blend Shape, On Blend Shape Threshold, On Tracking Lost, On Tracking Found.

## Non-goals

- Body calibration beyond the existing upper-body neutral and the SelfReflect position fix below. No arm-length or T-pose scaling.
- Finger calibration. Fingers connect as they arrive.
- More presets (VTube Studio, Rokoko, and others). A later preset adds data only.
- Generated Blueprints for the default tracking path.
- A second 3D render of the character inside the guide.
- A Set BlendShape mode that lowers a tracked value. Set BlendShape merges by max today. That limit stays.
- NDI, Windows, and mobile work.

## Anti-goals

The work fails, even if it runs, when one of these is true:

- The performer must type or pick a channel name.
- The guide stops and waits for a move that the app never sends.
- The performer must run the guide again after an app restart or after the show opens again.
- A deleted wire or a disabled graph stops face or body tracking.

## Decisions made with the owner

- Layout B: the guide replaces the inspector column. The scene stays visible. (Mockup: [walkthrough-layout.html](2026-10-21-tracking-setup-walkthrough/walkthrough-layout.html), option B.)
- The five steps as shown in [walkthrough-flow.html](2026-10-21-tracking-setup-walkthrough/walkthrough-flow.html).
- The mockups are fragments for the brainstorm companion. They show layout and intent, not final styles or copy.
- The coach is a drawn face, not a second copy of the character.
- iFacialMocap is a preset. The current receiver already works with it.
- The character has ARKit (perfect sync) blend shapes. Names map one to one.
- The Blueprint tracking nodes are part of this project.
- Every source has smoothing on, as iFacialMocap does today.
- A "Use bones for eye movement" toggle selects eye bones or `eyeLook*` blend shapes for the character's eyes.

## Facts from the probe

A probe on UDP 39539 recorded SelfReflect for 108 s. The summary is `fixtures/tracking/selfreflect-probe.summary.json`. The first 400 decoded packets (OSC messages as JSON, not raw bytes) are `fixtures/tracking/selfreflect-probe.jsonl.gz`. Slice 1 trims that file into a small replay fixture and removes the large file before it commits.

- 55 bones in VMC Unity names. These include `OriginalHips` (not humanoid), all 15 finger joints for each hand, `LeftEye`, and `RightEye`.
- 44 ARKit blend shapes with lowercase first letters (`eyeBlinkLeft`). The 8 `eyeLook*` channels are absent. Gaze comes through the eye bones.
- Low peaks: `jawOpen` 0.187, `browInnerUp` 0.314, `mouthSmileLeft` 0.278, `eyeBlinkLeft` 0.93. `cheekPuff` and `tongueOut` were present but stayed at 0.
- Only `Hips`, `OriginalHips`, `LeftHand`, and `RightHand` have a position that is not zero. The hand positions are absolute values on a centimeter scale (for example 67.66, 143.51, -5.99). The hips position was near (0.02, -0.64, -0.51). The first frame was a T-pose with the hips at (0, 1, 0). The root is always the identity.
- About 45% of the packets repeat the previous packet. The stream sends bursts at 60 packets per second and stops for up to 0.7 s. The mean was 9 packets per second.

Current code facts that the design uses:

- Face mapping, calibration, and smoothing are on the tracking source entity (`entity.mapping`, `entity.calibration`, `entity.smoothing`), not on the character (`packages/contracts/src/tracking.ts`).
- `BlendShapeRange` is `{inputMin, inputMax, outputMin, outputMax}`, all 0 to 1, keyed by canonical ARKit name. `canonicalArkitName` accepts `eyeBlinkLeft` and `eyeBlink_L` in any case.
- `calibrateTracking` captures only the neutral rotations from hips to head. The inspector hides Calibrate for VMC sources.
- The parser drops bones that are not humanoid, so `OriginalHips` is already gone. The renderer applies bone positions (`packages/renderer/src/avatar-pose.ts`).
- A sample older than 500 ms makes the source `stale`, and it fades out over 500 to 750 ms.
- The editor reads only tracking status (state and counts) through `appStatus`. It cannot read live channel values.
- `character.getBoneRotation` already reads the previous tick's tracked pose. A separate "Get Tracking Bone" node is not necessary.

## Design

### Presets

A preset is plain data in `packages/contracts` (for example `TRACKING_PRESETS`). Each preset has:

- `id`, `label`, and the source `kind` with its config defaults.
- The slots it fills: `body`, `face`, `fingers`.
- Whether the Connect step shows this computer's address or asks for the phone's address.
- The ordered list of expression steps.
- Its smoothing values (see "Smoothing").
- Its stream fixes (see "SelfReflect fixes").

| Preset | Kind | Config | Slots | Connect |
|---|---|---|---|---|
| SelfReflect | `vmc` | bind `0.0.0.0`, port 39539 | body, face, fingers | show this computer's address and port |
| iFacialMocap | `ifacialmocap` | bind `0.0.0.0`, port 49983, phone address from the performer | face | ask for the phone's address; the receiver sends the handshake |
| Other VMC app | `vmc` | bind `0.0.0.0`, port 39539 | body, face, fingers | as SelfReflect, no stream fixes |

### Smoothing

Every source that the guide creates or adopts must have smoothing on. The owner asked for this.

- The session already smooths each tracking source with a One Euro filter before calibration and mapping (`packages/session/src/tracking.ts`, `filterSample`). This applies to all kinds, not only iFacialMocap. A source with no `smoothing` field uses `DEFAULT_TRACKING_SMOOTHING` (on, min cutoff 5, beta 0.5, derivative cutoff 1).
- Each preset carries its own smoothing values. The guide writes them to the source with `setTrackingSmoothing` in the Connect patch. The values are then explicit in the show and visible in the Smoothing section.
- iFacialMocap and generic VMC start with the current defaults.
- SelfReflect starts with the defaults too. The builder tunes the values with a real stream in the slice 3 gates. SelfReflect sends bursts, repeated frames, and gaps, so its values can be different. Record the selected values and the reason in the slice evidence.
- When the guide adopts or reuses a source, it keeps that source's smoothing if smoothing is on. If smoothing is off, the guide turns it on with the preset values.
- `trackingProbe` values and the run peaks are smoothed values. The range fit then matches what the mapping receives, because the order is smoothing, then calibration, then mapping. A short spike that the filter removes does not set a range.

The default VMC bind address in `defaultTrackingConfig` is `127.0.0.1`. A phone cannot reach it, so the presets bind `0.0.0.0`.

iFacialMocap sends no body. Its preset binds only the face slot. Body and fingers stay as they are.

### Where the setup is stored

The setup stores everything on scene entities that exist now:

- The tracking source entity: config, `mapping.blendShapes`, and `calibration` where the kind allows it.
- The character's `tracking` bindings.

The show saves them. The guide stores no separate setup record.

The builder may add a `preset` id to the tracking source (my call: optional field). The inspector and the guide can then show which app the source is for. If added, it is a contract change in TypeScript and Rust.

### Commands

The setup uses the existing scene patch route for writes:

- Connect: one `scenePatch` with `createEntity` (the source) and `setAvatarTracking` (the bindings). The source is selected in this order (my call):
  1. A source of the same kind that is already in this character's slot: reuse it. Send `setTrackingConfig` only when the config differs.
  2. A source of the same kind that no character uses: adopt it, bind it, and set the preset config.
  3. A source of the same kind on the same endpoint that another character uses: the Connect step asks for the phone's address. The new source gets it as `senderAddress` (VMC) or `phoneAddress` (iFacialMocap), so the two sources share the endpoint. This supports two phones that drive two characters.
  4. Otherwise: create a new source.
- Relax: `calibrateTracking` where the kind allows it (iFacialMocap). For VMC, the sender calibrates, as today.
- End of Expressions: one `scenePatch` with a new `fitBlendShapeRanges` operation (see "Range fit"). The ranges are then live, so in "Try it" the real character shows the result. Done commits nothing more. Done only closes the guide.

`fitBlendShapeRanges { entityId, neutral }` follows the `calibrateTracking` pattern (my call):

- The live session resolves it into a saved `setTrackingMapping`.
- It uses the run peaks of that source and the `neutral` values that the client sends.
- Offline, it fails like `calibrateTracking` ("needs a live session").
- The editor and MCP send the same operation, so both get the same ranges from the same inputs.

The guide remembers the mapping from before the run, so Cancel can restore it.

The guide needs live raw channel values for the meters and the peaks, so this design adds one read call: `trackingProbe`.

- Request: `{ sourceId, resetPeaks?: boolean }`.
- Reply: `{ status, generation, values, peaks, presentChannels }`.
  - `values`: the current smoothed expressions, before calibration and mapping, keyed by canonical ARKit name.
  - `peaks`: the maximum of each channel since the last reset. These are the run peaks that `fitBlendShapeRanges` uses. The guide resets them once, at the start of Expressions. It computes the peak for each step (the meter tick) from the polled `values`.
  - `presentChannels`: the channels that the sender includes.
- The session keeps the peaks as runtime state for each source. The state is never saved, committed, or put in a frame.
- The host relays the call like `blueprintInspect`. TypeScript and Rust both check it.
- MCP gets a matching `tracking_probe` tool, so an agent can run and check the same setup.
- The guide polls it at 10 Hz (my call) while the guide is open. It stops polling when the guide closes.

Keeping the peaks in the session means that polling gaps do not miss a short peak.

### Step behaviour

The guide is a pure state machine in TypeScript (my call: a reducer in `apps/desktop/src/editor/`). It is unit tested without Svelte.

1. **Pick the app.** One tile for each preset.
2. **Connect.**
   - SelfReflect and generic VMC: show this computer's LAN IPv4 address (from `appStatus.localAddresses`) and the port in large type.
   - iFacialMocap: ask for the phone's address.
   - The step continues by itself when the source status is `receiving`. If an endpoint conflict happens, it shows the existing endpoint error.
3. **Relax.** A 3 s countdown. At the end the guide reads `trackingProbe` values as the neutral for each channel. For iFacialMocap it also sends `calibrateTracking`.
4. **Expressions.** Each step shows the coach and one meter for the main channel. The tick on the meter is the peak. The step ends by itself when one of these is true:
   - **Done:** the main channel rose above `neutral + 0.05`, and its peak did not rise for 1 s.
   - **Not sent:** the channel is absent from `presentChannels`, or its value did not change at all for 4 s while other channels changed. The guide marks it and goes on. This prevents the "stops and waits" anti-goal for SelfReflect `cheekPuff` and `tongueOut`.
   - **Skip:** the performer presses Skip, which is always available.

   Default step list (my call):

   | Step | Main channel | Also measured |
   |---|---|---|
   | Blink | `eyeBlinkLeft`, `eyeBlinkRight` | `eyeSquint*` |
   | Mouth wide | `jawOpen` | `mouthStretch*`, `mouthLowerDown*`, `mouthUpperUp*` |
   | Brows up | `browInnerUp` | `browOuterUp*` |
   | Smile | `mouthSmileLeft`, `mouthSmileRight` | `cheekSquint*`, `mouthDimple*` |
   | Frown | `mouthFrownLeft`, `mouthFrownRight` | `browDown*`, `noseSneer*` |
   | Pucker | `mouthPucker` | `mouthFunnel`, `mouthRoll*`, `mouthPress*` |
   | Puff cheeks | `cheekPuff` | |
   | Tongue out | `tongueOut` | |
   | Look around | eye bones, or `eyeLook*` when sent | |

   "Look around" writes no range when the app sends gaze only as eye bones. It shows the eyes move, so the performer can see that gaze works. This step also shows the "Use bones for eye movement" toggle (see "Eye movement"). If the eyes do not move, the performer can change it and see the result at once.
5. **Try it.** The ranges are already live. The character in the scene and the grouped meters (Eyes, Mouth, Brows) show the result. Done closes the guide.

### Range fit

The range fit is a pure function in `packages/session`, with unit tests. The `fitBlendShapeRanges` operation calls it. It takes the neutral values and the peaks, and it returns `blendShapes` ranges. The session merges them into the source's existing mapping.

For each channel that rose above its neutral by at least 0.05 in any step:

- `inputMin = min(neutral + 0.02, peak - 0.05)`
- `inputMax = max(peak × 0.9, inputMin + 0.05)`
- `outputMin = 0`, `outputMax = 1`

The guide writes no range for a channel that did not rise. If a range already exists for that channel, it stays. The factor 0.9 lets the performer reach full weight without the strongest effort. All the constants are my call. The builder may tune them with the real senders. The schema rules (`inputMin < inputMax`, all values 0 to 1) must stay true.

When the guide runs again on the same source, it replaces the ranges of the channels that it measured and keeps the others.

### Cancel

If the performer closes the guide before Done:

- If the fit was already sent, the guide sends `setTrackingMapping` with the mapping from before the run.
- If the guide created a new source in this run, it sends `removeEntity` for that source. This also clears the bindings.
- If the guide reused or adopted a source, the source stays. The guide restores the character's bindings from before the run.

(My call.)

### SelfReflect fixes

The probe shows two problems that the builder must check in the running app with a real SelfReflect stream. These are candidates with a selection gate. They are not decided behaviour.

1. **Positions.** The renderer applies bone positions. SelfReflect sends hand positions on a centimeter scale and a hips position below the floor. The likely result is broken arms and a sunken character.
   - Gate: load the character, run SelfReflect, and look at the arms and the hips height.
   - If the problem shows, add a per-source position rule to the VMC config. The candidates are: `rotations only`, or `hips position only, with the neutral offset captured in Relax`.
   - The SelfReflect preset sets the rule. This is a contract change (TypeScript, Rust, fixtures).
2. **Stalls.** SelfReflect stops sending for up to 0.7 s. The stale limit is 500 ms, so the character can flicker toward neutral.
   - Gate: watch the face and the body during a 2 min SelfReflect run.
   - If it flickers, add a per-source stale hold, set by the preset.

3. **Smoothing values.** With smoothing on, the character must move without visible jitter and without a jump after each gap.
   - Gate: compare the default smoothing values with at least one stronger setting during the same 2 min run.
   - The SelfReflect preset keeps the values that look best. If the defaults are sufficient, the preset keeps the defaults.

Record each gate result in the slice evidence and in the parity line.

### Eye movement

The owner asked for a "Use bones for eye movement" toggle. Senders and characters differ in how they move the eyes:

- **Senders.** SelfReflect sends gaze only as the `leftEye` and `rightEye` bones, with no `eyeLook*` channels. iFacialMocap sends eye bones and `eyeLook*` channels. Other senders can send only `eyeLook*`.
- **Characters.** Some have eye bones. Others move the iris only with `eyeLook*` blend shapes.
- **Today.** The session passes both through. Eye bones go to the eye bones (scaled by `eyeIntensity`), and `eyeLook*` goes to the morphs. A sender with only one kind cannot move a character that uses the other kind. A sender with both kinds can move the eyes twice.

The design adds `useEyeBones: boolean` to `TrackingMapping`, default `true`. It is a contract change in TypeScript, Rust, and the protocol fixtures. It goes in `packages/session/src/tracking-mapping.ts`, after the blend shape ranges:

- **On (bones).** The output eye bones move the eyes. If the sample has no eye bones, a pure function converts the `eyeLook*` values into eye bone rotations. The output drops the `eyeLook*` channels, so the eyes do not move twice.
- **Off (blend shapes).** The output `eyeLook*` channels move the eyes. If the sample has no `eyeLook*` channels, the pure function converts the eye bone rotations into `eyeLook*` values. The output drops the eye bone rotations.
- **Angles.** The conversion uses fixed maximum angles. My call: 20° horizontal (`eyeLookIn` and `eyeLookOut`), 15° vertical (`eyeLookUp` and `eyeLookDown`). `eyeIntensity` scales the result in both modes. The builder may read the VRM `lookAt` range maps later. That is not part of this project.
- **Default in the guide.** If the character's VRM has `leftEye` and `rightEye` humanoid bones, the guide sets the toggle on. If it has no eye bones, it sets it off. The guide always writes the value.
- **Where to change it.** The toggle is in the "Look around" step and in the Face section of the tracking source inspector (`TrackingMappingFields.svelte`).
- **Behaviour change.** A saved show has no `useEyeBones` field, so it reads as `true`. Its eye bones work as before. A sender that sends both kinds no longer drives the `eyeLook*` morphs. Record this change in the slice contract before coding it, and in the TRK-04 parity line.

Unit tests cover the conversion in both directions, the drop rules, and the default.

### Coach

- The coach is an SVG face. A pure function maps ARKit values to SVG shape parameters, for example jaw and lips, lids, brows, cheek width, tongue, and pupil offset.
- Each step has a short loop of keyframes (channel values over time). The face plays the loop while the step is active.
- A ring around the face fills as the step progresses.
- No animation library and no authored animation files (my call). The face is plain SVG and `requestAnimationFrame` in a Svelte component.
- With `prefers-reduced-motion`, the face shows the target pose without the loop.
- The coach shows the move in the direction the performer makes it (mirror view).

### Guide UI

- Build with Svelte 5 and `@oshi-connect/ui` (Button, Input, Select, Spinner). The kit has no stepper or progress bar. A thin step bar and the meter are small local components. If the kit owner wants them, they can move to the kit later.
- Constitution rules apply:
  - Short copy only.
  - No helper text that repeats a control.
  - No card grid, gradient, or side bar on the selected step.
  - One primary action for each step.
- Entry: a "Set up tracking" button in the Character tracking section (`AvatarSourceFields.svelte`). On a character with bound sources, the same button runs the guide again.
- The guide replaces the inspector column until Done or close. The scene view does not change.

### Blueprint tracking nodes

Add a `Tracking` category to `NODE_CATEGORIES`. The nodes:

| Node | Type | Settings | Ports | Reads |
|---|---|---|---|---|
| Get Tracking Blend Shape | `tracking.getBlendShape` | Character, BlendShape (ARKit) | out `value: number` | the previous tick's mapped pose (`env.previousPose`), before expressions and Blueprint blend shapes |
| On Blend Shape Threshold | `tracking.onBlendShapeThreshold` | Character, BlendShape, Threshold (0 to 1), Release (0 to 1, default threshold − 0.1) | out `rise: flow`, `fall: flow`, `value: number` | as above; fires `rise` once when the value crosses Threshold upward, and `fall` once when it drops below Release |
| On Tracking Lost | `tracking.onLost` | Source, After (s, default 2) | out `flow` | fires once when the source status is not `receiving` for the After time |
| On Tracking Found | `tracking.onFound` | Source | out `flow` | fires once when the source is `receiving` again after a Lost |

"Lost" means that the app stopped, not that one packet was late. The After time keeps a stalling sender such as SelfReflect (gaps up to 0.7 s) from firing Lost again and again. The edge state is in the node, so these nodes do not depend on the stale hold from slice 3 (my call).

Notes for the builder:

- Use `character.getBoneRotation` for tracked bones. Do not add a duplicate bone node.
- The event nodes need edge state for each node and the tracking status in `RunEnv`. They run in the input-event phase, after device triggers and before On Update.
- The node fields need a tracking source picker. The `blendshape` field kind exists; the builder checks that it offers the ARKit names.
- Rust needs no change for each node type. The palette and the MCP node docs come from the registry.

### Architecture and documentation

In the same commits:

- Update `ARCHITECTURE.md`: the `trackingProbe` call in the command and tracking paths, the peaks runtime state, the Tracking Blueprint nodes, and any position rule or stale hold that the gates add.
- Update the parity lines: TRK-23, TRK-01 (a real VMC sender on macOS is now checked), TRK-04, BP-05, and BP-06.
- Follow the spec-first workflow: analysis in `spdd/analysis/`, and REASONS contracts in `spdd/prompt/` for each slice.

## Suggested slices

This is my call. The builder may split them differently.

1. **Probe and fit.** Presets data, `trackingProbe` (contracts in TypeScript and Rust, router relay, session peaks, MCP tool), the `fitBlendShapeRanges` operation and its fit function, the `useEyeBones` mapping field and its conversion, and the SelfReflect replay fixture.
2. **Guide.** The state machine, the docked guide, the coach, the Character entry button, and the commit and cancel behaviour. Depends on slice 1.
3. **SelfReflect gates.** Run the three gates and set the SelfReflect smoothing values. Add the position rule and the stale hold only if the gates show a problem. Depends on slice 1. It can run in parallel with slice 2.
4. **Tracking nodes.** The four nodes and the `RunEnv` additions. Independent of slices 1 to 3, except that it shares the contracts package. The integrator orders the contract changes.

## Verification

- **Unit tests** (pure logic):
  - preset validation
  - the guide state machine, including the "not sent" and Skip paths
  - the range fit, including the schema rules
  - the coach value-to-shape function
  - threshold edge detection with release
  - lost and found transitions
- **Integration tests:**
  - Replay the SelfReflect fixture through the Rust parser and the host into the session. Check `trackingProbe` values, peaks, and `presentChannels`. Check that the values are smoothed (they differ from the raw replay at a jump), and that the source made by the Connect patch has smoothing on.
  - Check that `scenePatch` commits the ranges and that a reopened show keeps them.
  - The reason: these are process and protocol boundaries.
- **Running app** (macOS, the dev build):
  - Run the guide with a real SelfReflect stream and with a real iFacialMocap stream.
  - Check that the character's face reaches full mouth open with SelfReflect after setup.
  - Check gaze with SelfReflect (eye bones only) on a character with eye bones (toggle on) and with the toggle off. If a character with only `eyeLook*` morphs is available, check it too. Otherwise record that check as unknown.
  - Close and open the show, restart the phone app, and check that tracking comes back with no more steps.
  - Drive the setup through MCP with `tracking_probe` and the same `scenePatch` operations. From the same neutral and peaks, MCP must get the same ranges as the editor.
- **OBS output:** check the face and the body in the transparent OBS output with the tracked character. Record the backend, quality profile, fixture revision, and commit.
- **Blueprint nodes:** a graph with On Blend Shape Threshold on `tongueOut` (or `jawOpen` for SelfReflect) toggles an expression live. On Tracking Lost shows a toast when the phone app stops.

## Left to the builder

- The exact copy for each step, within the constitution's copy rules.
- The coach's drawing style and keyframes.
- The poll rate, the timing constants, and the range-fit constants, within the rules above.
- Whether the `preset` id goes on the source entity.
- The file layout for the new components and functions.
