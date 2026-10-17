# Warudo UI audit follow-up

Date: 2026-10-17. Source: a UI audit of Warudo 0.15.1 (Steam) on Windows 11 in a VM. The [parity checklist](../../warudo-parity.md) holds the result. Lines marked `UI audit 0.15.1` there come from this audit. The raw screenshots and notes stay outside the repository.

## Scope of the audit

The audit covered the editor shell, the Add Asset catalog, the camera, environment, light, screen, music player, motion recorder, and MediaPipe tracker inspectors, the blueprint editor and palette, the Steam Workshop tab, the settings, and the scene menu.

The audit did not cover a loaded character. Warudo crashed in the VM two times when it loaded the bundled character. Thus the character inspector (expressions, animation, IK, ragdoll, meshes), Setup Motion Capture, and Interactions Setup need a second audit on a host with a supported GPU.

## New checklist items

The audit added 19 items. Each has a roadmap issue with the `phase:later` and `status:planned` labels.

| Group | Items |
| --- | --- |
| Editor experience | UX-01 section index, UX-02 reset to default, UX-03 gallery picker and package card, UX-04 onboarding assistant, UX-05 language and dark mode, UX-06 contextual help |
| Cameras and output | CAM-11 follow, focus, and gamepad, CAM-12 handheld motion, CAM-13 layers, chroma key, and projection, CAM-14 virtual webcam, CAM-15 stylized effects, CAM-16 window size, render scale, and frame pacing |
| Motion capture | TRK-22 exclude virtual webcams, TRK-23 guided setup for a character |
| Blueprints | BP-14 format a graph, BP-15 palette favorites and counts |
| Other | MED-10 synced lyrics, SHOW-06 FPS counter, CHR-12 MMD playback |

The audit also added detail lines to 24 existing items. The largest are TRK-04 (blend shape range mapping), TRK-07 (MediaPipe controls), MED-02, MED-03, and MED-05 (screen content and appearance), and BP-13 (palette inventory: 33 categories, 519 nodes).

## Recommended order

1. **Small editor changes.** UX-02, UX-01, TRK-22, BP-15, BP-14, and SHOW-06. Each is small, is used every day, and needs no new platform adapter.
2. **Camera production.** CAM-13, CAM-11, CAM-12, CAM-15, and CAM-16. They extend the existing camera entity and the output path. Verify each in OBS.
3. **Setup flows.** TRK-23 first, then UX-03 and UX-04. TRK-23 gives the wiring that UX-04 calls. Build UX-04 with layout and one primary action, not with the colored card grid that Warudo uses (constitution principle 2).
4. **Platform adapter.** CAM-14 needs a macOS camera extension investigation. Record it as a candidate with a selection gate before you write code.
5. **Content features.** MED-10 and CHR-12 wait for MED-08 (music player) and CHR-05 (animation layers).
6. **Shell.** UX-05 and UX-06 follow when the editor copy is stable.

Each new command must go through the same validated command API as MCP.

## Keep the OpenSekai lead

The audit found places where OpenSekai is already better, or where a planned item can do better. Do not lose them when you copy Warudo behavior.

- Warudo has undo and redo only in the blueprint editor. OpenSekai also has it only there now. Scene undo (OSE-09) would be a lead.
- Warudo has no canvas context menu and no wire-release search in the blueprint editor. OpenSekai has both.
- Reload Scene in Warudo discards unsaved edits with no prompt, and the scene does not save itself. OpenSekai must prompt or recover (OSE-09).
- The Warudo MediaPipe tracker process continued after a scene reload removed its asset. An OpenSekai tracker must stop with its asset.
