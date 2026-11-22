# Quality Profile Effects Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put an explicit `effectsQuality` (`cheap` | `full`) on each Output Quality profile so Preview and Performance cheapen the look stack and Production stays full, without UI changes.

**Architecture:** Extend the frozen `QUALITY_PROFILES` table in `@opensekai/contracts`. Point `lookQuality(id)` at `QUALITY_PROFILES[id].effectsQuality`. Update unit tests and SHOW-05 / architecture text for Performance cheap. No new Settings surface, no profile ID churn, no demo scene in this plan.

**Tech Stack:** TypeScript, Vitest, existing lens-look cheap/full levers, pnpm workspace.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-22-quality-profile-effects-budget-design.md`
- Figma (decisions only): https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai-UI?node-id=92-10
- Keep profile IDs `preview_v1` / `production_v1` / `performance_v1` and Output Quality Select unchanged
- `preview_v1` + `performance_v1` → `cheap`; `production_v1` → `full`
- No shadows / LOD / preview-rate knobs; no effects demo scene
- Rust has `QualityProfileId` only (no profile table mirror) — do not add Rust fields for `effectsQuality`
- Prefer unit tests for the table and `lookQuality`; no UI unit suite
- Run Rust/cargo builds through `direnv exec . <command>` when needed; this plan is TypeScript-only

## File map

| File | Role |
| --- | --- |
| `packages/contracts/src/quality.ts` | Add `effectsQuality` to `QualityProfile` + table rows |
| `packages/contracts/test/quality.test.ts` | Assert frozen table includes `effectsQuality` |
| `packages/renderer/src/lens-look.ts` | `lookQuality` reads the table field |
| `packages/renderer/test/lens-look.test.ts` | Expect Performance cheap |
| `spdd/prompt/2026-10-16-quality-controls.md` | Requirements note for `effectsQuality` |
| `docs/warudo-parity.md` | SHOW-05: look-stack budget in profile; Performance cheap |
| `ARCHITECTURE.md` | Chain-key sentence: Preview + Performance are cheap |
| `docs/superpowers/specs/2026-11-22-quality-profile-effects-budget-design.md` | Mark implemented after Task 3 |

---

### Task 1: Contracts — `effectsQuality` on `QUALITY_PROFILES`

**Files:**
- Modify: `packages/contracts/src/quality.ts`
- Modify: `packages/contracts/test/quality.test.ts`
- Test: `packages/contracts/test/quality.test.ts`

**Interfaces:**
- Consumes: existing `QualityProfileId`, `QUALITY_PROFILES`
- Produces:
  - `export type EffectsQuality = 'cheap' | 'full'` (or inline union on the field — prefer named type for clarity)
  - `QualityProfile.effectsQuality: EffectsQuality`
  - Table: `preview_v1.effectsQuality = 'cheap'`, `production_v1.effectsQuality = 'full'`, `performance_v1.effectsQuality = 'cheap'`

- [x] **Step 1: Write the failing test**

Update `packages/contracts/test/quality.test.ts` so the frozen-table assertion includes `effectsQuality`:

```ts
it("keeps the frozen v1 values", () => {
    expect(QUALITY_PROFILES).toEqual({
        preview_v1: { id: "preview_v1", resolutionScale: 0.5, maxTextureSize: 1024, msaaSamples: 4, effectsQuality: "cheap" },
        production_v1: { id: "production_v1", resolutionScale: 1, maxTextureSize: 2048, msaaSamples: 4, effectsQuality: "full" },
        performance_v1: { id: "performance_v1", resolutionScale: 1, maxTextureSize: 1024, msaaSamples: 0, effectsQuality: "cheap" },
    });
    expect(Object.isFrozen(QUALITY_PROFILES.production_v1)).toBe(true);
});
```

Keep the other tests in that file unchanged.

- [x] **Step 2: Run test to verify it fails**

Run: `direnv exec . pnpm exec vitest run --project unit packages/contracts/test/quality.test.ts`

Expected: FAIL — received objects lack `effectsQuality` (or deep-equal mismatch).

- [x] **Step 3: Write minimal implementation**

In `packages/contracts/src/quality.ts`, replace the `QualityProfile` interface and table with:

```ts
export type EffectsQuality = "cheap" | "full";
export interface QualityProfile {
    readonly id: QualityProfileId;
    readonly resolutionScale: 1 | 0.5;
    readonly maxTextureSize: 1024 | 2048;
    readonly msaaSamples: 0 | 4;
    readonly effectsQuality: EffectsQuality;
}
// A profile is a frozen measurement setting: a changed numeric value needs a new ID.
// effectsQuality is a look-stack budget field added without new IDs (see 2026-11-22 design).
export const QUALITY_PROFILES: Readonly<Record<QualityProfileId, QualityProfile>> = Object.freeze({
    preview_v1: Object.freeze({ id: "preview_v1", resolutionScale: 0.5, maxTextureSize: 1024, msaaSamples: 4, effectsQuality: "cheap" }),
    production_v1: Object.freeze({ id: "production_v1", resolutionScale: 1, maxTextureSize: 2048, msaaSamples: 4, effectsQuality: "full" }),
    performance_v1: Object.freeze({ id: "performance_v1", resolutionScale: 1, maxTextureSize: 1024, msaaSamples: 0, effectsQuality: "cheap" }),
});
```

Export `EffectsQuality` from `packages/contracts/src/index.ts` if that barrel re-exports quality types explicitly; if it uses `export * from './quality'`, no barrel edit.

- [x] **Step 4: Run test to verify it passes**

Run: `direnv exec . pnpm exec vitest run --project unit packages/contracts/test/quality.test.ts`

Expected: PASS (all tests in the file).

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/quality.ts packages/contracts/test/quality.test.ts packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add effectsQuality to quality profiles

Preview and Performance are cheap; Production is full. Same profile IDs.
EOF
)"
```

---

### Task 2: Renderer — `lookQuality` reads the table

**Files:**
- Modify: `packages/renderer/src/lens-look.ts`
- Modify: `packages/renderer/test/lens-look.test.ts`
- Test: `packages/renderer/test/lens-look.test.ts`

**Interfaces:**
- Consumes: `QUALITY_PROFILES`, `QualityProfileId`, `EffectsQuality` from `@opensekai/contracts` (Task 1)
- Produces: `lookQuality(profile: QualityProfileId): LookQuality` where `LookQuality` stays `"full" | "cheap"` and equals `QUALITY_PROFILES[profile].effectsQuality`

- [x] **Step 1: Write the failing test**

In `packages/renderer/test/lens-look.test.ts`, update the look-quality describe block:

```ts
describe('look quality (R30, D5)', () => {
    it('makes preview and performance cheap and production full', () => {
        expect(lookQuality('preview_v1')).toBe('cheap');
        expect(lookQuality('production_v1')).toBe('full');
        expect(lookQuality('performance_v1')).toBe('cheap');
    });
    // keep effectQuality and flare/smear cheap-tier assertions as they are
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `direnv exec . pnpm exec vitest run --project unit packages/renderer/test/lens-look.test.ts`

Expected: FAIL on `lookQuality('performance_v1')` — still `'full'`.

- [x] **Step 3: Write minimal implementation**

In `packages/renderer/src/lens-look.ts`:

1. Change the contracts import to include `QUALITY_PROFILES` (keep other imports).
2. Replace:

```ts
export const lookQuality = (profile: QualityProfileId): LookQuality => (profile === "preview_v1" ? "cheap" : "full");
```

with:

```ts
export const lookQuality = (profile: QualityProfileId): LookQuality => QUALITY_PROFILES[profile].effectsQuality;
```

Do not change `effectQuality`, `lookChainKey`, DoF/flare/anamorphic cheap levers, or `renderer.ts` (it already calls `lookQuality(quality.id)`).

- [x] **Step 4: Run test to verify it passes**

Run: `direnv exec . pnpm exec vitest run --project unit packages/renderer/test/lens-look.test.ts`

Expected: PASS.

Also run: `direnv exec . pnpm exec vitest run --project unit packages/contracts/test/quality.test.ts packages/renderer/test/lens-look.test.ts`

Expected: both PASS.

- [x] **Step 5: Commit**

```bash
git add packages/renderer/src/lens-look.ts packages/renderer/test/lens-look.test.ts
git commit -m "$(cat <<'EOF'
fix(renderer): cheapen look stack for performance_v1

lookQuality reads QUALITY_PROFILES.effectsQuality so Performance matches Preview.
EOF
)"
```

---

### Task 3: Docs, parity, mark spec implemented

**Files:**
- Modify: `spdd/prompt/2026-10-16-quality-controls.md`
- Modify: `docs/warudo-parity.md` (SHOW-05 bullet)
- Modify: `ARCHITECTURE.md` (look-stack / quality-tier sentence only)
- Modify: `docs/superpowers/specs/2026-11-22-quality-profile-effects-budget-design.md` (status line)

**Interfaces:**
- Consumes: Task 1 table values; Task 2 `lookQuality` behavior
- Produces: docs that match shipped behavior; no code API change

- [x] **Step 1: Update the quality-controls contract**

In `spdd/prompt/2026-10-16-quality-controls.md`:

- Extend **R2** so a profile also has `effectsQuality` (`cheap` | `full`): `preview_v1` and `performance_v1` are `cheap`; `production_v1` is `full`. Keep the “changed numeric value needs a new ID” rule; note `effectsQuality` was added on the existing IDs (2026-11-22).
- Extend **E — Entities** `QualityProfile` shape to include `effectsQuality`.

Do not rewrite unrelated requirements (anti-aliasing, Output URL rules).

- [x] **Step 2: Update SHOW-05 parity**

In `docs/warudo-parity.md`, edit the SHOW-05 bullet so it states:

- Profiles still set resolution scale, texture limit, and MSAA.
- Profiles also set look-stack `effectsQuality` (Preview + Performance cheap; Production full) for DoF / flare / anamorphic.
- Shadows, LOD, and preview rate are still not in a profile.

Keep the Linux / macOS evidence sentences; do not claim new OBS timing evidence for this docs-only task. Leave the checkbox unchecked unless the owner later verifies.

- [x] **Step 3: Update ARCHITECTURE.md**

Find the lens-look sentence that says the quality tier (`preview_v1` is cheap) is in the chain key. Change it so Preview **and** Performance are cheap (Production full), driven by `QUALITY_PROFILES.effectsQuality` / `lookQuality`. Do not rewrite the rest of that paragraph.

Also find the later sentence that says the profile sets drawing buffer scale, texture limit, and MSAA. Add that it also sets look-stack `effectsQuality` (same cheap/full mapping).

- [x] **Step 4: Mark the design spec implemented**

In `docs/superpowers/specs/2026-11-22-quality-profile-effects-budget-design.md`, set:

`Status: implemented (<commit-sha-after-this-task>)`.

Use the Task 3 commit SHA after the commit lands (amend only if hooks auto-edit and the amend rules allow; otherwise a tiny follow-up status commit is fine — prefer one commit that includes the status with `HEAD` placeholder replaced after commit via a second commit only if needed). Practical approach: commit docs first, then one-line status update with the SHA of that docs commit, or set status to `implemented` without SHA if the branch tip will be recorded in the PR.

Preferred: after the docs commit, amend is **not** required — set `Status: implemented` in the same commit as the doc edits (SHA can be filled in the PR body). Use:

`Status: implemented (this branch).`

- [x] **Step 5: Commit**

```bash
git add spdd/prompt/2026-10-16-quality-controls.md docs/warudo-parity.md ARCHITECTURE.md docs/superpowers/specs/2026-11-22-quality-profile-effects-budget-design.md
git commit -m "$(cat <<'EOF'
docs: record quality profile effectsQuality budget

SHOW-05 and architecture note Performance cheapens the look stack.
EOF
)"
```

---

## Plan self-review

1. **Spec coverage:** Intent/data/runtime/evidence/out-of-scope map to Tasks 1–3. Demo scene explicitly excluded.
2. **Placeholders:** None.
3. **Types:** `effectsQuality` / `EffectsQuality` / `LookQuality` stay `'cheap' | 'full'`; `lookQuality(QualityProfileId)` signature unchanged for `renderer.ts`.
