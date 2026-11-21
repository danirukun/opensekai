# lilToon warm stall analysis

Date: 2026-11-21. Scope: the first next step of the [#269](https://github.com/danirukun/opensekai/issues/269) decision after PR [#320](https://github.com/danirukun/opensekai/pull/320). Parent slice: [lilToon on WebGPU](2026-11-19-liltoon-webgpu.md). Related: [#74](https://github.com/danirukun/opensekai/issues/74) (MAT-02), [#322](https://github.com/danirukun/opensekai/issues/322) (selection gate waits on this work when the stall gate fails).

## Problem

1. **The warm Editor-preview stall gate is open again.** The #269 decision says: continue with slice 2 only after the shader is cheaper. The warm gate is a spot light add at 8 lit lights, measured to GPU completion, limit 250 ms on each renderer. At fork `2d29c26` the gate passed (190 ms preview, 197 ms OBS). At the current pin `716557b`, a later run gave **329 ms** on the Editor preview (OBS 211 ms). The same session also gave **352 ms** for the control build `2d29c26`, so the cause of the preview failure is not known.
2. **A possible measurement fault remains.** The evidence page records that the WebKit HTTP cache of the app can serve an earlier fork build after an in-place `node_modules` change. The failed run may not have drawn the build that its label names. A clean pin install and a cache bust are required before more shader work.
3. **`.warudo` import and MAT-03 wait.** The #269 order is: cheaper shader and a closed stall gate, then `.warudo` (rights review), then MAT-03 (#75). Issue #322 also waits on the shared property nodes when the stall gate requires them.

## Current state

- **Shared property nodes are in the fork.** Commit `2082247` makes one program key for materials that share the same variant, features, and texture presence. Commit `2d29c26` syncs the shared texture in the update phase (not update-before), so a nested shadow-map render does not replace the main texture of the outer draw. OpenSekai pins `716557b`, which includes both.
- **Fork unit tests cover the share.** `test/webgpu/programShare.test.ts` checks equal keys for equal features, distinct keys for feature or sampler changes, and per-draw values and textures.
- **The sample still has many light-dependent pipelines.** The Catboy lilToon sample has 16 materials and 8 outlines (24 programs). The MToon Catboy has about 13. A warm cached pipeline costs about 5 ms in WebKit. Twenty-four pipelines alone can approach the 250 ms budget when other work is present.
- **Shadow-pass programs stay one per material.** three r187 builds a new shadow-override node graph per source material. Those programs are small. They must be counted apart from the main-pass share when a stall is measured.
- **The look of slice 1 must not regress.** Calibration, OBS alpha, and the owner look check of #320 stay the reference. This slice does not change the feature list or the lighting model rules of R3–R8 unless a stall fix needs a documented, measured change.

## Decisions

- **First action is a clean re-measure (owner order from #269).** Install the fork at a known commit through the package manager (no in-place overwrite of `node_modules`). Clear or bypass the WebKit HTTP cache of the app for that run. Measure warm spot add at 8 lit lights on the Editor preview and the OBS output, for the lilToon sample and the MToon Catboy, with GPU completion in the stall. Record the fork commit, the OpenSekai commit, and the method that proves the loaded JS is that fork commit.
- **If the preview gate passes at `716557b`, stop the shader work.** Record the closed gate. The #269 item 1 is done. Do not change the fork for cost alone.
- **If the preview gate still fails, reduce unique light-dependent programs further in the fork.** Prefer changes that keep the look. Candidate directions, in order of preference:
  1. Prove the share works in the running app (count distinct `customProgramCacheKey` values for the loaded sample; expect far fewer than 24 if many materials share features).
  2. Share or shrink shadow-pass programs where three allows it without a three patch.
  3. Cut dead feature branches from the WGSL of materials that do not use them (already partly done by feature keys).
  4. Reject a return to a band set for each light (owner rejected that for OBS cost).
- **OpenSekai changes stay thin.** Pin bump, evidence, contract Status, and MAT-02 parity line. No new avatar features. No `.warudo` import. No MAT-03 features.
- **Selection gate for #322.** When this slice closes the warm gate (or records that `716557b` already passes after a clean measure), the shared-nodes part of the #322 gate is satisfied.

## Effects

- The warm stall gate of R9 is either closed with a measured number ≤ 250 ms on both renderers, or a further fork change lands and the gate is closed after it.
- The evidence page names the method that proves which fork build the app ran.
- MAT-02 stays partial. The parity line records the new stall numbers and the fork pin.
- Slice 2 sources (`.warudo`, then MAT-03) remain blocked on their own gates.

## Open questions

1. Is a permanent `gpudone` timing path in the app required, or is a local evaluation patch enough for this slice? Prefer the smallest change that makes the gate reproducible.
2. If the clean re-measure fails and shadow-pass programs dominate, does the owner accept a temporary higher preview limit only when shadows are on, or must the 250 ms limit stay absolute?
