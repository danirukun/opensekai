# VRMA clip-backed idle check

Slice: [VRMA clip idle](../../spdd/prompt/2026-11-22-vrma-clip-idle.md) (CHR-04 slice 1). Status: **macOS WebGPU + transparent OBS** (2026-11-22 / 2026-11-23).

## Run

| Field | Value |
| --- | --- |
| Platform | macOS 27.2 (darwin 27.2.0), Apple Silicon |
| Commit | worktree `feat/chr04-idle-override-clips` at `dfac258d` + uncommitted slice 1 sources |
| Backend | WebGPU (`output_main`) |
| OBS | 33.0.2, WebSocket 5.7.6, 1920×1080@60, isolated QA scene |
| Avatar | Nina (`avatar_07d241…`) |
| Clip | `fixtures/animation/idle-subtle.vrma` → `animation_b74da2ac…` (4 s loop; ~0.6° chest pitch / ~0.4° roll + 55° arm drop, same scale as builtin idle) |
| Assign | MCP `setAvatarIdle` `{kind:clip, enabled:true, assetId}` after library load |

## Verified

- Contracts / session / `prepare_animation` unit tests.
- Editor: Tracking → Idle animation on; Idle source = clip name; Import animation control present ([editor-idle-source.png](vrma-clip-idle/editor-idle-source.png)).
- **Subtle clip loop (current fixture):** upright A-pose; no back-break. Frames ~1.2 s apart differ by ~4–6% AE ([obs-subtle-a.png](vrma-clip-idle/obs-subtle-a.png) … [obs-subtle-c.png](vrma-clip-idle/obs-subtle-c.png); [obs-subtle-b-comp.png](vrma-clip-idle/obs-subtle-b-comp.png)). Builtin vs subtle AE ≈ 1.6% ([obs-builtin-ref.png](vrma-clip-idle/obs-builtin-ref.png)).
- **Tracking takeover / fade:** VMC body on `127.0.0.1:39541` reached `receiving` (60 Hz feed); OBS during feed [obs-tracking-on.png](vrma-clip-idle/obs-tracking-on.png); after stop, source `stale` and pose returned toward clip idle [obs-tracking-fade.png](vrma-clip-idle/obs-tracking-fade.png) (AE on→fade ≈ 4.7%).
- **Minimized continuity:** Editor hidden 8 s; `output_main` sequence 6739→7311 (+572), tick +614, still connected; [obs-after-minimize.png](vrma-clip-idle/obs-after-minimize.png).

## Earlier extreme fixture (not Warudo-like)

First OBS pass used a synthetic `chest-sway` with **chest 0°→90° Z** ([obs-clip-a.png](vrma-clip-idle/obs-clip-a.png) …). That “breaks the back” look is the fixture, not normal Warudo idle. Warudo ships AGIA / Kawaii standing idles (subtle poses), not 90° torso spins. Extreme frames kept only as contrast; current check uses `idle-subtle`.

## Not verified

- Rest-pose world-matrix retarget (ThreeVRM); slice 1 still maps sampler rotations by humanoid name.
- Native file-dialog `import_animation` end to end (library staging + MCP assign used here).
- Real AGIA / user Mixamo VRMA quality on a production avatar.

## Remaining CHR-04 gaps

Overlay layers (slice 2), transient one-shots (slice 3), Mixamo FBX (#268 / slice 4). See [dependency plan](../superpowers/plans/2026-11-22-chr04-idle-override-clips.md).
