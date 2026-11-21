# REASONS: lilToon warm stall close

Date: 2026-11-21. Analysis: [lilToon warm stall](../analysis/2026-11-21-liltoon-stall.md). Parent: [lilToon on WebGPU](2026-11-19-liltoon-webgpu.md). Plan: [lilToon warm stall plan](../../docs/superpowers/plans/2026-11-21-liltoon-stall.md). Issues: [#269](https://github.com/danirukun/opensekai/issues/269) (next-step order), [#74](https://github.com/danirukun/opensekai/issues/74) (MAT-02), [#322](https://github.com/danirukun/opensekai/issues/322) (gate).

Status: contracted, not implemented. Parent slice is checked on macOS. This slice closes the warm Editor-preview stall gate of parent R9, or proves the current pin already passes after a clean measure.

## R — Requirements

1. **Clean warm measure of the current pin** (analysis Decision 1). With OpenSekai at this branch and the fork at the pin in `packages/renderer/package.json` (today `716557b`), run a warm spot light add at 8 lit lights on the Editor preview and on the OBS output, for the lilToon sample and the MToon Catboy.
   - Stall = time from the `scene_patch` that adds the light to GPU completion of the first frame at the new revision (`queue.onSubmittedWorkDone`), as parent R9.
   - The install of the fork is a package-manager install of that commit. Do not overwrite files under `node_modules` in place for the gate run.
   - The evidence names how the run proves the loaded JS is that fork commit (for example a content hash of the served `webgpu` module, or a one-line build id logged at material construction that matches the pin).
   - Gate: spot add at 8 lit lights ≤ 250 ms on each renderer. Cold stall and MToon ratios are recorded and do not fail the check.
2. **Stop or continue by the measure** (analysis Decisions 2 and 3). If R1 passes on both renderers, do not change the fork for cost. If the Editor preview fails, change the fork so that materials that already share a program key keep that share in the running app, and reduce the number of light-dependent programs that a light add rebuilds, until R1 passes.
   - Prefer fixes that do not change the look of the Catboy lilToon sample under the Unity reference rig.
   - Do not restore a band set for each light.
   - A fork change that lands in this slice is pinned in OpenSekai in the same checkpoint as the new evidence.
3. **Program share stays correct** (parent R2 / fork `2082247` + `2d29c26`). Two `LilToonNodeMaterial`s with the same variant, features, and texture presence keep the same `customProgramCacheKey()`. Each material still draws with its own values and textures. The shared texture sync stays in the update phase so a nested shadow-map render does not replace the outer draw texture. Fork unit tests in `test/webgpu/programShare.test.ts` stay green.
4. **Evidence and parity** (parent R9 subset). Update `docs/evaluation/liltoon-webgpu.md` with the new warm table, the build-proof method, and any fork pin change. Update the MAT-02 line in `docs/warudo-parity.md` and the Status of this contract. Claim only verified numbers. An unavailable measurement is unknown, never zero.
5. **No look regression of slice 1.** OBS alpha over black, white, and checker stays correct. The Unity reference face and shadow-band ratios of parent R9 are not re-opened unless a stall fix changes shading; if it does, re-run the calibration window and record the result.

## E — Entities

- Fork `danirukun/three-liltoon` branch `webgpu`: `LilToonNodeMaterial`, shared property and texture nodes, `test/webgpu/programShare.test.ts`.
- OpenSekai: `packages/renderer` pin of `@mochiya/three-liltoon`, `docs/evaluation/liltoon-webgpu.md`, `docs/warudo-parity.md` MAT-02, this contract Status.
- Measurement: the local stall harness under `~/.claude/orchestrate/opensekai/` (`stall-avatar.mjs`, `gpudone-timing` path). Not committed unless this slice promotes a minimal, durable timing hook.

## A — Approach

1. Write this contract and the plan (done with the analysis).
2. Run R1 with a clean pin install and a build proof.
3. If R1 fails on the preview: inspect distinct program keys of the loaded sample; apply the smallest fork fix that cuts light-add rebuild cost; rebuild `dist/`; pin; re-run R1.
4. Update evidence and MAT-02; set Status.

## S — Structure

- Fork changes stay under `src/webgpu/` and `test/webgpu/`, with committed `dist/webgpu.*`.
- OpenSekai: pin string, evidence, parity, contract Status. No new material profile. No new SPDD entities beyond this slice.

## O — Operations

1. From the `liltoon-stall` worktree: `direnv allow` once; every cargo / Rust-compiling pnpm command through `direnv exec .`.
2. Fork tests: `npx vitest run test/webgpu` and `npm run build:webgpu` in the fork checkout.
3. Stall: run the app with `OPENSEKAI_EVALUATION=1` and the local fixture manifest; warm prime then warm gate; record JSON next to the orchestrate folder or in the evidence appendix path named in the plan.
4. Commit OpenSekai docs and pin with short imperative messages. Commit fork changes on `webgpu` with no agent attribution. Do not push until the owner asks.

## N — Norms

- Prose is ASD-STE100. UI copy is not added.
- Spec and evidence stay in sync with the pin and the measured numbers.
- Verify `pwd` before Git. No `git -C`, no compound `cd`, no bare `git stash`.

## S — Safeguards

- Do not commit an avatar file or a Unity project.
- Do not change the MToon path, three, or three-vrm versions.
- Do not start `.warudo` import or MAT-03 features in this slice.
- Do not claim the gate closed without the clean-measure method of R1.
- Do not attribute commits or pull requests to an agent.
- Do not start a live stream for a check. Local OBS test recording and screenshots are allowed.
