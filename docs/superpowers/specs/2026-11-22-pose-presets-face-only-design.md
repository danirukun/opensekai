# Pose presets for face-only tracking (Warudo-like)

Date: 2026-11-22. Status: approved. Issue: [#296](https://github.com/danirukun/opensekai/issues/296). Related: CHR-04 (#10), CHR-06 (#12), VPoyo gaps.

Owner decisions (2026-11-22): full overlay list (Warudo-shaped); wave is a short loop; Hand Pin is in the first PR.

## Intent

A face-only streamer can pick a built-in upper-body pose (rest, selfie, wave, hands on mic, holding a controller). The head, chest, and shoulders still follow face tracking. The hands stay in the pose. Switch from the Inspector, a hotkey, or a Blueprint node, with a short blend. The choice is saved in the show.

## Warudo reference (0.15.1, VM check)

Warudo does not use one “pose tab”. It splits the job:

1. **Override Hand Poses** — per hand: Enabled, Pose (built-in finger shapes), Weight, High Priority over mocap. Built-ins include Open, Fist, Grab, Hold 1/2, Peace, Pistol Grip, Thumbs Up, and others. Wave is not a hand pose.
2. **Idle + Overlaying Animations** — full-body or masked arm motion (AGIA/KA packs). Transition time blends overlays (default 1 s). Mocap still wins on tracked bones unless masked/priority says otherwise.
3. **Body IK** — pin a hand (or spine) to a target or temporary anchor so face-driven body motion does not drift the hands.

OpenSekai today: procedural builtin idle (`AvatarIdle`), Face-Only Body Motion (offsets + pendulum), `boneOffsets`, no overlay clips, no Override Hand Poses, no Body IK.

## Goals

- G1. Character Inspector section **Animation** gains Warudo-shaped controls for this slice: Overlaying Pose (named presets), Override Hand Poses (left/right), and Hand Pin (Body IK subset for hands only).
- G2. Built-in overlay presets at least: `rest`, `selfie`, `wave`, `mic`, `controller`. Each is a saved upper-body bone set (arms + hands; optional shoulders), not an imported `.anim` yet.
- G3. Built-in hand shapes for Override Hand Poses cover the Warudo names that this product needs for those presets (at least Open, Fist, Grab, Hold 1, Hold 2, Peace, Idle). Full Warudo list can grow later.
- G4. Switch overlay pose and/or hand overrides from Inspector, hotkey (`event.keystroke` + patch), and Blueprint (`character.setOverlayPose` / `character.setHandPose`). Blend over a short transition (default ~0.4–1 s, matching Warudo overlay transition).
- G5. With face-only tracking (or Face-Only Body Motion), head/chest/spine still follow the face; arm/hand bones come from the overlay + hand pose + optional pin.
- G6. Saved on the avatar in the show. Unit tests cover blend of overlay and hand-pose weight over time.

## Non-goals

- N1. Import Mixamo/VRMA/AGIA `.anim` files (CHR-04 later). Built-in procedural/baked overlays only.
- N2. Full CHR-06: Look At IK, foot IK, spine IK targets, temporary-anchor UI, ragdoll.
- N3. Prop Attach To / Override Hand Pose on props (ENV-03 slice 2).
- N4. Replacing Face-Only Body Motion; pose layers compose with it (hand/arm overlay after or instead of arm pendulum when an overlay is active).

## Anti-goals

- Do not claim Warudo clip parity or AGIA packaging.
- Do not route pose through continuous image IPC.
- Do not break concert timing or two-performer tracking evidence.

## Approaches considered

1. **Single opaque pose id on the avatar** that writes all arm bones. Simpler, less Warudo-like. Rejected by owner preference.
2. **Blueprint-only Offset Bones graphs.** Editable, but not Inspector-first and not saved as character Animation settings.
3. **Warudo-like three controls on the character (selected).** Overlaying Pose + Override Hand Poses + Hand Pin. Overlays are built-in bone libraries until CHR-04 imports clips. Hand Pin is a first Body IK subset (hold current or preset wrist targets while torso tracks).

## Design

### Data (show / contracts)

On each avatar (Animation group):

- `overlayingPoses`: list (0..N) of `{ id, pose: 'rest'|'selfie'|'wave'|'mic'|'controller'|…, maskedBodyParts, weight, speed? }`. Warudo-shaped: many overlays, lower list entry wins on overlapping bones.
- `overlayTransitionSeconds`: number (default 1), Warudo “Overlaying Animations Transition Time”.
- `overrideHandPoses`: `{ left?: HandOverride, right?: HandOverride }` where `HandOverride = { enabled, pose: HandPoseId, weight, highPriority }`.
- `handPin`: `{ left?: HandPin, right?: HandPin }` where `HandPin = { enabled, mode: 'preset'|'hold' }` — `preset` uses the active overlay wrist target; `hold` freezes the wrist at enable time. Full IK solver later; first slice may implement pin as absolute arm chain toward a saved local target (same visual job as Warudo’s temporary anchor tip).

Patches: `setAvatarOverlayPose`, `setAvatarHandPose`, `setAvatarHandPin` (or one `setAvatarAnimation` group). MCP and Blueprint use the same ops.

### Evaluation (session)

Compose order (Warudo-like priority, mocap highest unless High Priority hand pose):

1. Builtin idle baseline (existing).
2. Tracking compose (face/body) — head/chest/spine from face-only path.
3. Overlaying pose: blend into arm (and masked) bones over `overlayTransitionSeconds` when the active pose id changes. While an overlay is active, suppress Face-Only arm/finger pendulum writers for those bones (torso lean / body-follows-head stay).
4. Override Hand Poses: finger (and optionally hand) bones; if `highPriority`, replace tracking fingers; else only fill when fingers are not tracked (face-only default).
5. Hand Pin: keep wrists at pin targets; still allow finger overrides.
6. Blueprint `boneOffsets` last (existing), so graphs can fine-tune.

### Built-in overlay content

Author five upper-body poses as data (normalized Euler or quats per bone) under contracts or session, tuned on Catboy / fixture VRM. `wave` is a short procedural loop (not a held still); other presets are held poses. Imported AGIA clips remain CHR-04.

### UI / switch paths

- Inspector Animation: Overlaying Pose select, transition, Override Hand Poses (Warudo field labels), Hand Pin enable per hand.
- Hotkeys: Blueprint template or scene bindings that call the patch ops.
- Blueprint nodes to set overlay id and hand pose with optional transition.

### Tests / evidence

- Unit: blend of overlay A→B over T; hand pose weight; highPriority vs face-only fingers; pin holds while head yaw changes.
- Headless editor: Inspector + patch round-trip save/load.
- macOS + OBS later: face-only + selfie/wave visible; record in evaluation doc. Do not claim until checked.

## Parity

- CHR-04: still Partial (builtin idle only; overlays are not imported clips).
- CHR-06: Partial subset — Hand Pin only; Look At / full Body IK remain Later.
- `docs/vpoyo-gaps.md` gap 3 moves to In progress when code lands; Done after OBS check.

## Resolved owner choices

1. Full overlay list (many entries, Warudo priority by list order).
2. Wave: short procedural loop in this slice.
3. Hand Pin included in the first PR with Overlay + Override Hand Poses.
