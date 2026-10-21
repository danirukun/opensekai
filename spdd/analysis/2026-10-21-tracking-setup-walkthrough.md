# Guided tracking setup analysis

Date: 2026-10-21. Scope: TRK-23 ([#167](https://github.com/danirukun/opensekai/issues/167)), with TRK-01, TRK-04, BP-05, and BP-06. Mode: contract-first. Design: [guided tracking setup](../../docs/superpowers/specs/2026-10-21-tracking-setup-walkthrough-design.md). Plan: [implementation plan](../../docs/superpowers/plans/2026-10-21-tracking-setup-walkthrough.md). Contracts: [S1 probe and fit](../prompt/2026-10-21-tracking-setup-s1-probe-fit.md), [S2 guide](../prompt/2026-10-21-tracking-setup-s2-guide.md), [S3 SelfReflect gates](../prompt/2026-10-21-tracking-setup-s3-selfreflect-gates.md), [S4 tracking nodes](../prompt/2026-10-21-tracking-setup-s4-tracking-nodes.md). Depends on the merged B5 and B6 contracts ([tracking receive](../prompt/2026-10-18-tracking-receive-two-performers.md), [calibration and tracking overrides](../prompt/2026-10-18-calibration-tracking-overrides.md)).

## Sources

- [Warudo Motion capture overview](https://docs.warudo.app/docs/mocap/overview). **Setup Motion Capture** generates Blueprints, because the Warudo receivers do not drive the character. The OpenSekai character already binds its sources, so the guide writes scene data only.
- The SelfReflect probe: 108 s on UDP 39539. The summary is `fixtures/tracking/selfreflect-probe.summary.json`. It shows 55 bones, 44 lowercase ARKit channels, no `eyeLook*` channel, low peaks (`jawOpen` 0.187), hand positions on a centimeter scale, a hips position below the floor, and stalls of up to 0.7 s.
- The approved design, which owns the behavior. The plan owns names, files, and tests.

## Current state

- Face mapping, calibration, and smoothing are fields of the tracking source entity. The session smooths each source with a One Euro filter, then calibrates, then maps, then mixes, then fades.
- `calibrateTracking` resolves in the live session. The inspector hides Calibrate for VMC sources.
- The editor reads only the tracking status (state and counts). It cannot read live channel values.
- `canonicalArkitName` merges `eyeBlinkLeft` and `eyeBlink_L`.
- `applyMapping` runs only when a source has a `mapping`. A source with no mapping passes eye bones and `eyeLook*` channels through unchanged.
- `character.getBoneRotation` reads the previous tick's tracked pose.

## Requirements

Each requirement below comes from one design section. The slice contracts give the testable form.

R1. **Presets.** Three presets are plain data in `packages/contracts`: SelfReflect (VMC, port 39539, body, face, fingers), iFacialMocap (port 49983, face only, the phone address from the performer), and Other VMC app (as SelfReflect, no stream fixes). Each preset has its config, slots, Connect mode, smoothing, and the ordered nine expression steps. Presets bind `0.0.0.0`. Owner: S1.
R2. **Smoothing.** A source that the guide creates or adopts has smoothing on. Each preset writes its smoothing values with `setTrackingSmoothing`. The guide keeps the smoothing of a reused source when it is on, and turns it on with the preset values when it is off. Probe values and peaks are smoothed values. Owner: S1 (data), S2 (patch), S3 (SelfReflect values).
R3. **Commands.** Connect is one `scenePatch` with the source and the bindings. The source choice follows this order: reuse the source in the slot of the character, adopt a free source of the same kind, ask for the phone address when another character uses the same endpoint, else create a new source. The end of Expressions is one `scenePatch` with `fitBlendShapeRanges`. A new read call, `trackingProbe`, gives the smoothed values, the run peaks, and the present channels. MCP gets a matching `tracking_probe` tool. The guide polls at 10 Hz while it is open. Owner: S1 (calls), S2 (plans and polling).
R4. **Step behavior.** The guide is a pure reducer with five steps: Pick, Connect, Relax, Expressions, Review. Connect stores the source on the `connected` event and stays in Connect. The guide enters Relax at the first probe whose state is `receiving`. Relax counts 3 s, takes the probe values as the neutral, and calls `calibrateTracking` for iFacialMocap. Each expression step ends as done (the peak rose 0.05 above the neutral and did not rise for 1 s), as not sent (the channel is absent, or its value did not change for 4 s while other channels changed), or as skipped. Owner: S2.
R5. **Range fit.** A pure function in `packages/session` turns the neutral values and the run peaks into ranges. A channel that rose by at least 0.05 gets `inputMin = min(neutral + 0.02, peak - 0.05)`, `inputMax = max(peak x 0.9, inputMin + 0.05)`, `outputMin = 0`, `outputMax = 1`. The session merges the ranges into the existing mapping. A second run replaces only the measured channels. Owner: S1.
R6. **Cancel.** Closing the guide before Done restores the mapping from before the run when the fit was sent. It removes a source that the run created. For a reused or adopted source, it restores the bindings of the character. The plan sends no operation for an entity that is gone. Owner: S2.
R7. **Eye movement.** `TrackingMapping` gets `useEyeBones`, default `true`. The bones mode converts `eyeLook*` into eye bones when the sample has no eye bones, and drops `eyeLook*`. The blend shape mode converts eye bones into `eyeLook*` when the sample has none, and drops the eye bones. The conversion uses 20 degrees horizontal and 15 degrees vertical. The guide writes the value from the `eyeBones` flag of the VRM asset record. Owner: S1 (field, conversion, flag), S2 (guide control).
R8. **SelfReflect fixes.** Three gates run with a real stream: positions, stalls, and smoothing values. A fix (a position rule, a stale hold, new smoothing values) is added only when its gate fails. These stay candidates until the evidence selects them. Owner: S3.
R9. **Coach.** The coach is a drawn SVG face. A pure function maps ARKit values to shape parameters. Each step has a keyframe loop. A ring shows the progress. The face shows the target pose with `prefers-reduced-motion`. The view is a mirror view. Owner: S2.
R10. **Guide UI.** The guide uses Svelte 5 and `@oshi-connect/ui`. It replaces the inspector column and leaves the scene view unchanged. The entry is a "Set up tracking" button in the character tracking section. The copy is short, and there is no card grid, gradient, badge, or side bar on the selected step. Owner: S2.
R11. **Blueprint nodes.** A Tracking category has four nodes: Get Tracking Blend Shape, On Blend Shape Threshold, On Tracking Lost, and On Tracking Found. The event nodes keep edge state in the runtime and run in a tracking phase after device triggers and before On Update. Lost needs an After time, so a stalling sender does not fire it again and again. Owner: S4.

## Behavior changes

The two changes below alter how an existing show behaves. They are recorded here before any code, as the spec-first rule asks. The S1 contract repeats them, and the TRK-04 parity line records them.

1. **`useEyeBones` default `true` drops `eyeLook*` when eye bones are present.** A saved show has no `useEyeBones` field, so it reads as `true`. Eye bones keep their motion as before. A sender that sends both eye bones and `eyeLook*` (for example iFacialMocap) no longer drives the `eyeLook*` morphs. Today the eyes can move twice. A character that has only `eyeLook*` morphs and a sender that sends both kinds now sees gaze from the bones only. The performer sets `useEyeBones` to `false` to get the morphs.
2. **A source with no mapping now gets the eye rule applied.** Today `applyMapping` does not run for a source with no `mapping`. After this work it runs the eye rule with `useEyeBones` set to `true`, and nothing else. Thus the change in item 1 also applies to a source that never had a mapping. All other mapping steps stay as they are for a source with no mapping.

## Effects

- A performer can pick an app on a character, connect it, relax, make each face, and see the character react. The setup stays in the show, so it needs no repeat after a restart.
- A weak sender such as SelfReflect drives the full blend shape after the fit.
- An agent can run the same setup through `tracking_probe` and `scene_patch` and get the same ranges.
- A Blueprint can read a tracked blend shape and react to a threshold, a lost source, and a found source.
- The show format gets one optional mapping field (`useEyeBones`), one optional asset field (`eyeBones`), and one patch operation (`fitBlendShapeRanges`). The protocol gets one read call (`trackingProbe`). The gates can add a position rule and a stale hold.

## Risks

- The two behavior changes can change the gaze of an existing show. The performer can set `useEyeBones` to `false`.
- A short spike that the filter removes sets no range. This is by design. The fit matches what the mapping receives.
- The run peaks live in the session. A restart of the source clears them, and the fit must not use peaks from an older generation.
- SelfReflect hand positions and stalls can break the arms and flicker the face. The gates in S3 decide this with a real stream. Mock data cannot decide it.
- Two names for one channel (`eyeBlink_L` and `eyeBlinkLeft`) must merge by maximum in the probe, the peaks, and the fit.

## Out of scope

Body calibration beyond the existing upper-body neutral, arm-length and T-pose scaling, finger calibration, more presets, generated Blueprints for the default path, a second 3D render in the guide, a Set BlendShape mode that lowers a tracked value, NDI, Windows, and mobile work. A real phone, a real SelfReflect stream, and OBS checks stay with the owner, except where the plan runs them in the dev build.
