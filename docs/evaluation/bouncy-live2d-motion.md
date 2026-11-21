# Bouncy Live2D motion check

Date: pending. Scope: VPoyo gap 2 ([#294](https://github.com/danirukun/opensekai/issues/294)). Contract: [bouncy Live2D motion](../../spdd/prompt/2026-11-21-bouncy-live2d-motion.md). Design: [bouncy Live2D motion design](../superpowers/specs/2026-11-21-bouncy-live2d-motion-design.md).

Status: not run. No result is verified. The code is in the Face-Only Body Motion template, and the bounce is off by default.

Record for each run: commit, platform, backend, quality profile (`production_v1` for OBS), OBS video size and FPS, avatar asset ID, and the tracking source. Keep app timing and OBS timing separate. A value that was not measured is unknown, not zero.

## Results

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Face-only character, `Bouncy Motion` off: no bounce translation and no bounce scale in the pose | | |
| 2 | `Bouncy Motion` on: the upper body sinks when the chin drops, and rises when the chin comes up | | |
| 3 | OBS at 60 FPS: no visible jitter in the bounce | | |
| 4 | Editor minimized: the OBS bounce continues | | |
| 5 | A body source on the character: the bounce writers skip the covered bones | | |
| 6 | VMC send: the translation is on the wire, and the scale is not (known difference) | | |

## Not verified

Everything above.
