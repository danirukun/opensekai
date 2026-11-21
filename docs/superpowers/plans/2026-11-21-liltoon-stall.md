# lilToon Warm Stall Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the warm Editor-preview stall gate for the Catboy lilToon sample (spot light add at 8 lit lights ≤ 250 ms to GPU completion), or prove the current fork pin already passes after a clean measure.

**Architecture:** Re-measure first with a package-manager pin install and a proof of which fork JS the app loads. If the preview still fails, cut light-dependent program rebuild cost in the fork (`danirukun/three-liltoon` branch `webgpu`) while keeping program share and the look of slice 1. OpenSekai only bumps the pin and updates evidence and MAT-02.

**Tech Stack:** three r187 WebGPU/TSL, fork `@mochiya/three-liltoon` git pin, OpenSekai desktop + OBS WebSocket, local stall harness in `~/.claude/orchestrate/opensekai/`.

**Spec:** `spdd/analysis/2026-11-21-liltoon-stall.md`, `spdd/prompt/2026-11-21-liltoon-stall.md`. Parent: `docs/superpowers/specs/2026-11-19-liltoon-webgpu-design.md`.

## Global Constraints

- Never commit an avatar file or Unity project.
- No agent attribution in commits or pull requests.
- Run cargo / Rust-compiling pnpm through `direnv exec .` from the worktree. Verify `pwd` before Git. No `git -C`, no compound `cd`, no bare `git stash`.
- Do not restore a band set for each light.
- Do not start `.warudo` import or MAT-03 in this plan.
- Long prose is ASD-STE100.

## File Structure

| File | Responsibility |
| --- | --- |
| `spdd/analysis/2026-11-21-liltoon-stall.md` | Analysis (already written). |
| `spdd/prompt/2026-11-21-liltoon-stall.md` | Slice contract (already written). |
| Fork `src/webgpu/LilToonNodeMaterial.ts` and tests | Only if R1 fails and a cost fix is needed. |
| `packages/renderer/package.json`, `docs/dependencies.md` | Pin bump when the fork changes. |
| `docs/evaluation/liltoon-webgpu.md`, `docs/warudo-parity.md` | New warm numbers and claims. |

---

### Task 1: Commit the slice contract

**Files:**
- Create: `spdd/analysis/2026-11-21-liltoon-stall.md`
- Create: `spdd/prompt/2026-11-21-liltoon-stall.md`
- Create: `docs/superpowers/plans/2026-11-21-liltoon-stall.md`

- [x] **Step 1: Confirm** the three files match the #269 next-step order and the open preview gate at `716557b`.
- [x] **Step 2: Commit** from the worktree root:
  ```sh
  git add spdd/analysis/2026-11-21-liltoon-stall.md spdd/prompt/2026-11-21-liltoon-stall.md docs/superpowers/plans/2026-11-21-liltoon-stall.md
  git commit -m "$(cat <<'EOF'
  Add the lilToon warm stall close slice contract.

  EOF
  )"
  ```

---

### Task 2: Clean warm measure of pin `716557b`

**Files:**
- Modify (later): `docs/evaluation/liltoon-webgpu.md` (only after numbers exist)
- Use (local): `~/.claude/orchestrate/opensekai/character-lighting/stall-avatar.mjs` and the liltoon `gpudone-timing` path

- [x] **Step 1: Install** from the worktree so the fork pin resolves fresh:
  ```sh
  direnv exec . pnpm install --filter @opensekai/renderer...
  ```
  Confirm `node_modules/@mochiya/three-liltoon` (or the pnpm store path) resolves to commit `716557bd077748417d7bf9f80d7b9c2a1a14fa23`.
- [x] **Step 2: Prove the loaded build.** Prefer a content hash of `dist/webgpu.js` from the resolved package, logged once at app start or written into the stall JSON. Do not rely on an in-place copy into `node_modules`.
- [x] **Step 3: Launch** with evaluation fixtures:
  ```sh
  OPENSEKAI_EVALUATION=1 OPENSEKAI_FIXTURE_MANIFEST=<repo>/fixtures/local/manifest.json direnv exec . pnpm dev:desktop
  ```
- [x] **Step 4: Warm prime** then **warm gate** for lilToon sample and MToon Catboy, `preview_main` and `output_main`, spot add at 1 / 3 / 8. Include GPU completion in the stall.
- [x] **Step 5: Record** the table (ms) and the build proof in the orchestrate folder. Decide: pass → Task 4; fail on preview → Task 3.

Passed at `716557b` (preview 227 ms, OBS 215 ms). Task 3 skipped.

---

### Task 3: Fork cost fix (only if Task 2 preview fails)

**Files (fork):**
- Modify: `src/webgpu/LilToonNodeMaterial.ts` (and related webgpu modules as needed)
- Modify: `test/webgpu/programShare.test.ts` (and new tests)
- Rebuild: `dist/webgpu.js`, `dist/webgpu.d.ts`

- [ ] **Step 1: Count** distinct `customProgramCacheKey()` values for the loaded Catboy lilToon materials (main + outline). Compare to the 24 pipeline count in the evidence page.
- [ ] **Step 2: Write a failing test** for the chosen fix (for example shadow-pass key share, or a proven per-material node still in the key).
- [ ] **Step 3: Implement** the smallest fix. Keep shared texture sync in `update()`, not `updateBefore()`.
- [ ] **Step 4: Run** `npx vitest run test/webgpu` and `npm run build:webgpu` in the fork. Expected: PASS.
- [ ] **Step 5: Commit** in the fork on `webgpu` (no agent credit). Pin that commit in OpenSekai `packages/renderer/package.json` and `docs/dependencies.md`.
- [ ] **Step 6: Re-run** Task 2 Steps 1–5 against the new pin. Repeat Task 3 only if the preview still fails and a new cause is known.

---

### Task 4: Evidence and status

**Files:**
- Modify: `docs/evaluation/liltoon-webgpu.md`
- Modify: `docs/warudo-parity.md` (MAT-02 stall sentences)
- Modify: `spdd/prompt/2026-11-21-liltoon-stall.md` (Status)
- Modify if pin changed: `ARCHITECTURE.md` only when the dependency map text becomes false

- [x] **Step 1: Write** the warm table, build-proof method, and pass/fail into the evidence page.
- [x] **Step 2: Update** MAT-02 to claim only the new verified stall numbers.
- [x] **Step 3: Set** contract Status to implemented and checked (or measured-pass-without-fork-change).
- [x] **Step 4: Commit** OpenSekai docs (and pin if changed).
- [x] **Step 5: Comment** on #269 that item 1 of the next-step order is done, with the measured numbers and the pin.
- [x] **Step 6: Run** `direnv exec . cargo sweep --time 7` from the worktree when the feature finishes.

## Review Focus

1. The gate run used a package-manager pin install, not an in-place `node_modules` overwrite.
2. The evidence proves which fork commit the app loaded.
3. Program share tests still pass; shared texture sync stays in the update phase.
4. MAT-02 claims match the measured numbers only.
