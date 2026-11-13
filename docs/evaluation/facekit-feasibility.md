# FaceKit feasibility check (B33)

Date of the runs: 2026-11-11. Scope: TRK-24, bundle B33 ([#260](https://github.com/danirukun/opensekai/issues/260)). Design: [Native FaceKit face tracking on macOS](../superpowers/specs/2026-11-11-facekit-macos-tracking-design.md). Tool: [FaceKit probe](../../tools/facekit-probe/README.md). Base commit: `bbdc7fb`.

This record gives the facts from the throwaway spike that became the probe tool. It does not verify OpenSekai behavior. The platform verification record is a later slice.

## Feasibility gate

Issue #260 asks two questions: is private-API dependence acceptable for the intended distribution, and is there a permitted, maintainable integration path?

- **Distribution.** The owner answered on 2026-11-11: the public GitHub-release build can call the private API when the source is opt-in and fails gracefully.
- **Integration path.** The spike found a path that works on the test Mac: `dlopen` and four C functions, with no build-time link and no Apple file in the repository. The results are below.
- **Open.** A notarized Developer ID build and the legal scope of the Apple developer agreement for private API use outside the App Store are unknown. They are not passed. The current release is ad hoc signed, so they do not block the first version.

## Setup

- **Host.** MacBook Pro Mac15,6 (Apple M3 Pro), macOS 27.2 (26B123).
- **Framework.** AppleCVA 1003.0.4 at `/System/Library/PrivateFrameworks/AppleCVA.framework/Versions/A/AppleCVA` (in the dyld shared cache). `CVAFaceTrackingGetAPIVersion` returned 42.
- **Camera.** Built-in FaceTime HD Camera, default format, 1920x1080, `420f` output.
- **Tool.** An Objective-C command-line tool, written from exported symbol names and key strings only. It is now `tools/facekit-probe/facekit_probe.m`. The committed probe removes the `--recognition` option and the `has_faceprint` field of the spike, always sets `use_recognition` to false, and adds the `raw_tongue` field. The runs below used the spike. The tool was ad hoc signed with the camera entitlement. One variant was signed with the hardened runtime.
- **Start.** From Terminal.app through `.command` files. The owner was in front of the camera.

## Method

- One first run of 8 s.
- One guided run of 70 s. A voice told the performer 17 movements, 4 s each. The performer moved 2.5 to 3.5 s after each prompt.
- Nine variant runs of 5 s, each with one change: `use_recognition` false, fitting off, both, hardened runtime, 640 pixels width, focal length 300, focal length 600, the FaceKit face detector, and `force_cpu`.
- Each run recorded one JSON line for each callback. The recordings are not committed.

## Results

| Check | Result |
| --- | --- |
| Load | `dlopen` with the absolute path works. `CVAFaceTrackingGetAPIVersion`, `CVAFaceTrackingCreate`, `CVAFaceTrackingProcess`, and `CVAFaceTrackingCopySemantics` resolve with `dlsym`. |
| Create | Returned 0 with no AppleCVA entitlement. The first call in a session took 1.6 to 1.9 s. Later calls took about 16 ms. |
| Hardened runtime | With the hardened runtime and the camera entitlement (ad hoc signature), `Create` returned 0 and tracking ran (157 callbacks for 157 frames). |
| Names | `CopySemantics` returned `blendshape_names` with 51 names. The order is in the design, "Facts from the spike". |
| Input | The create options of the design and one input dictionary for each frame (design Appendix A) gave results. The face rectangle came from Vision. A synthetic focal length is sufficient: 300 and 600 changed only the translation depth (median 376 and 728). |
| Callbacks | `Process` returned in 0.1 ms (median). FaceKit called the block one time for each `Process` call (2083 of 2083 in the guided run), on the thread `com.apple.applecva.facekit.1`. |
| Output shape | `tracked_faces[0]` has `raw_data` and `smooth_data`. `animation.blendshapes` is 204 bytes (51 `float32` values). `pose.rotation` is 3 rows of 3 numbers. `raw_data.animation` has `tongue_out`. |
| Frame rate | 29.5 frames per second in the guided run. 23.8 to 28.5 in the 5 s runs. |
| Callback latency | Guided run: median 5.8 ms, 95th percentile 17.4 ms. All runs except the detector and `force_cpu` runs: median 4.8 to 6.9 ms, 95th percentile 9.9 to 23.7 ms. |
| CPU | Capture, Vision, and FaceKit together: 38% of one core in the guided run and in the first run. 45 to 53% in the 5 s runs except the detector and `force_cpu` runs. These runs include the start. |
| FaceKit face detector | Median latency 41 ms, 95th percentile 355 ms. Vision is the better choice. |
| `force_cpu` | Median latency 10.8 ms, 61% of one core. |
| Lower resolution | The tool set a 640x480 format, but the frames stayed 1920x1080. The cost at a lower resolution is unknown. |
| Lost face | With the camera covered, `tracked_faces` became empty. One callback in the transition had a face entry with `failure_type` 1 and no pose or blend shapes. The face came back about 1.8 s after the prompt to uncover. This time includes the reaction of the performer. |
| Camera permission | A process that the agent session starts does not get the camera prompt. A start from Terminal.app works. Then Terminal.app is the responsible process. |
| Frame-to-frame change | At a neutral face: 0.0055 for each channel in `raw_data`, 0.0030 in `smooth_data`. |

### Conventions

These come from the one guided run. They are inferred, not verified on an avatar.

- The neutral rotation is near `diag(1, -1, -1)`. With rows 2 and 3 negated, the matrix gives: a turn to the performer's left is +Y (+32°), to the right is -Y (-40°); chin down is +X (+15°); a tilt to the right shoulder is +Z (+22°), to the left shoulder is -Z (-20°). The chin-up prompt gave no clear row. These signs are the VRM 1 normalized head axes when the performer's left is the avatar's left.
- `eyeBlink_L` follows the performer's left eye (0.84 to 0.88 with the right eye at 0.25).
- Maximum values in the guided recording: `mouthSmile_L` 0.76 and `mouthSmile_R` 0.77 (`raw_data`), `tongue_out` 1.0 (`smooth_data`), `jawOpen` 0.64 (`raw_data`) with a wide-open jaw.
- Neutral offsets: `browDown_L` and `browDown_R` 0.22 to 0.43, `eyeSquint_L` and `eyeSquint_R` 0.11 to 0.25, `mouthShrugLower` about 0.1, `jawOpen` 0.02.

Rotation rows. The label is the movement that the row shows, not the prompt of that moment.

| Movement | Rotation as delivered (`raw_data.pose.rotation`) | Vector after the conversion (degrees, X Y Z) |
| --- | --- | --- |
| Turn to the performer's left | `[[0.8462, -0.0219, 0.5323], [-0.0012, -0.9992, -0.0391], [0.5328, 0.0325, -0.8456]]` | [-2.2, 32.2, 0.7] |
| Turn to the performer's right | `[[0.7688, -0.051, -0.6375], [-0.0596, -0.9982, 0.008], [-0.6368, 0.0318, -0.7704]]` | [-0.7, -39.6, 3.4] |
| Chin down | `[[0.9991, -0.0333, -0.0268], [-0.0255, -0.9676, 0.2512], [-0.0343, -0.2503, -0.9676]]` | [14.5, -1.8, 1.7] |
| Tilt to the right shoulder | `[[0.886, -0.3471, -0.3074], [-0.3749, -0.9265, -0.0343], [-0.2729, 0.1456, -0.9509]]` | [-5.4, -17.3, 21.5] |
| Tilt to the left shoulder | `[[0.9308, 0.3381, 0.139], [0.3535, -0.9293, -0.1073], [0.0929, 0.149, -0.9845]]` | [-7.5, 6.8, -20.3] |

## Identity data

- `identity_coefficients` (2004 bytes) is in each face entry that has a pose, also with `use_recognition` false, with fitting off, and with both. Only the face entries with no pose and no blend shapes did not have it.
- No run had a faceprint key or a `debug` key.
- The spike could not show that FaceKit stops the identity computation. This is not verified.
- The claim for OpenSekai is: identity data is not read, not stored. The probe records only whether the `identity_coefficients` key is present. It never reads or prints the values of `identity_coefficients`, `face_id`, or `debug`.

## Fixture

`fixtures/tracking/facekit-frames.json` holds one frame for each of 10 guided movements: `neutral`, `head_left`, `head_right`, `head_down`, `tilt_left`, `tilt_right`, `jaw_open`, `blink_left`, `smile`, and `tongue`. The `source` object names the host, the OS, AppleCVA, the API version, and the camera.

- **Rule.** For each movement, the rows with a face at 1.5 s or more after the start of that movement. The row in the middle of them by time. Each number is rounded to 4 decimals.
- **Fields.** `rotation` is `raw_data.pose.rotation`. `blendshapes` is the 51 `raw_data.animation.blendshapes` values in the FaceKit order. `tongueOut` is `smooth_data.animation.tongue_out`, because the guided recording did not keep the `raw_data` value.

### Fixture rows and the lag

The performer moved 2.5 to 3.5 s after each prompt. The middle row of the window from +1.5 s to the end of the phase is at about +2.8 s. Thus the `head_left`, `head_right`, `tilt_left`, and `jaw_open` rows show the transition, not the pose.

Measured values against the `neutral` row. Rotation: the delivered matrix with rows 2 and 3 negated, as a rotation vector in degrees (X Y Z).

| Row | Against `neutral` | What the row shows |
| --- | --- | --- |
| `head_left` | [-2.1, +11.2, -2.0] | The start of the turn to the left. The full turn is +32° on Y. |
| `head_right` | [+0.8, -10.1, -1.3] | The middle of the turn from left to right. The full turn is -39° on Y. |
| `tilt_left` | [+13.2, +2.5, -0.6] | The chin down of the prompt before. No tilt. |
| `jaw_open` | `jawOpen` 0.0541 against 0.0185 (+0.036) | A closed jaw. The jaw opened in the next phase. |

The other rows show their movement: `head_down` +13.8° on X, `tilt_right` +18.3° on Z, `smile` `mouthSmile_L` 0.7432 against 0, `tongue` `tongueOut` 1.0, `blink_left` `eyeBlink_L` 0.8811 against `eyeBlink_R` 0.2913.

Lag evidence from the guided recording, read in steps of 0.5 s. Times are after the prompt.

- `head_left` (prompt at 5.2 s): Y stays near -2° until +2.3 s. Y is +8.6° at +2.8 s, +20.6° at +3.4 s, and +32° from +4.4 s. Y passes half of its final value between +2.8 and +3.4 s.
- `head_right` (prompt at 9.4 s): Y stays at +31° until +1.7 s. Y is -14.0° at +2.8 s, -28.9° at +3.3 s, and -39° from +4.4 s.
- `head_down` (prompt at 17.8 s): X stays at -12° to -14° until +1.7 s. X is +9.6° at +2.2 s and +13.1° at +2.7 s.
- `tilt_left` (prompt at 22.0 s): X stays at +13° (chin down) until +2.6 s. Z is -5.3° at +3.2 s, -15.3° at +3.7 s, and -20.3° at +4.2 s, in the `tilt_right` phase.
- `jaw_open` (prompt at 34.5 s): `jawOpen` stays at 0.06 or less until +3.0 s. It is 0.51 at +4.0 s, in the `blink_left` phase.

The recording was in a temporary directory, and it was deleted after the fixture was made. Thus nobody can take the rows again with a different window. The turn and tilt signs come from the five rows of the design, Appendix B (also in "Conventions" above), not from the fixture.

## Unknown

- A notarized Developer ID build with the hardened runtime.
- The legal scope of the Apple developer agreement for this use.
- Intel Macs, and macOS 14 through 26.
- External and virtual cameras.
- The cost at a lower capture resolution.
- Which compute unit FaceKit uses.
- Whether FaceKit can stop the identity computation.
- More than one face.
