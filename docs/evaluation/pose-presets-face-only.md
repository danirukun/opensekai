# Pose presets for face-only tracking (#296)

Status: **local OBS run recorded** (2026-11-22). Gap stays In progress until an owner accepts the Needs-owner items and sleeve-obscured hand visibility.

Commit `d7fffbaa` · macOS 27.2.1 · OBS 33.0.2 (1920×1080@60) · WebGPU · `production_v1` on `output_main` · `pnpm dev:desktop` with `OPENSEKAI_EVALUATION=1` · avatar Rem Kanashibari (`avatar_395ee928…`) · face source iFacialMocap loopback (`pnpm evaluate:tracking-feed` / fixed UDP). Evidence: `docs/evaluation/evidence/pose-presets-face-only/` and `/tmp/qa-pose-presets-296/evidence/`.

App timing (sample): `output_main` cpuMs ≈ 2.9, gpuMs ≈ 1.11. OBS timing: unknown (not measured).

## Code checks (done)

- Contracts: `AvatarAnimation` schema, `setAvatarAnimation` patch, Rust round-trip.
- Session: overlay libraries (including wave loop), hand poses, hand pin, `composeAvatarAnimation`, Face-Only writer skip via `animationMaskedBones`.
- Blueprint: `character.setOverlayPose`, `character.setHandPose`, `character.setHandPin`; Pose Hotkeys template (Control+Option+1..5).
- Editor: Animation Inspector section; `setAvatarAnimation` on the editor model.

## OBS checklist

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Face-only: head/chest follow face; overlay holds arms | Pass | IFM `receiving`; rest vs selfie OBS frames differ (PSNR avg ≈ 14.7); blend mid shows raised/bent arms (`07-blend-mid.png`); wave sequence differs while face feed runs (`08-wave-head-*.png`) |
| 2 | Overlay A→B over transition: continuous blend | Pass | `overlayTransitionSeconds: 1`, rest→selfie; `07-blend-0/mid/end.png` all different MD5; mid≠start (PSNR ≈ 16.4), mid≠end (≈ 14.6), start≠end (≈ 13.5) |
| 3 | Wave while editor minimized | Pass | Window hidden via System Events; `09-minimized-a/b.png` differ (PSNR ≈ 19.1) |
| 4 | Hand High Priority on/off with tracked fingers | Needs owner | No finger tracker in this run. High Priority on set fist/peace in `animation` (rev 11). Rem sleeves hide hands. Tracked-finger case not proven on OBS |
| 5 | Hand Pin hold + head yaw ±30° | Pass (approx) | Pin hold on; IFM yaw 0→30°; head crop changes more (PSNR ≈ 19.2) than arm crop (≈ 22.2). Pin is hand-bone hold, not full IK |
| 6 | Transparent OBS: arms/hands with alpha | Pass | OBS PNG over gray (`14-alpha-composite.png`); character visible, background gray (alpha preserved) |

## Not verified

- Clear finger shapes on a short-sleeve / bare-hand model with a live finger source (check 4).
- Full Body IK pin targets (check 5 is approximate hold).
- MCP `capture_frame` diagnostic preset returned `STALE_FRAME` once in this run; OBS WebSocket screenshots were used instead.

## Timing

| Path | Value |
| --- | --- |
| App `output_main` cpuMs | ≈ 2.9 |
| App `output_main` gpuMs | ≈ 1.11 |
| OBS frame time | unknown |
