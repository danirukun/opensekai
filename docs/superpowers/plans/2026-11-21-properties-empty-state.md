# Properties Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Properties has no selected asset, show short guidance copy via a shared desktop `EmptyState` component.

**Architecture:** Add `EmptyState.svelte` in `apps/desktop` (message prop, centred muted text). Wire it into `Inspector.svelte` when `entity` is missing. Keep the Properties heading and Help button. No `@oshi-connect/ui` change. Other panes reuse this component in later slices.

**Tech Stack:** Svelte 5, design tokens in `apps/desktop/src/app.css`, pnpm, browser check for UI evidence.

**Spec:** `docs/superpowers/specs/2026-11-21-properties-empty-state-design.md`

## Global Constraints

- Exact empty-state copy: `Select an asset from Assets to view or edit its properties.`
- Muted centred text only. No icon, badge, pill, card, or gradient.
- Constitution principles 1 and 2: actionable empty state is allowed; do not add helper text under fields.
- No unit test for static copy. Verify in the browser. PR gets before and after screenshots.
- Svelte 5 runes (`$props`). Functional TypeScript. Comment only hard logic.
- Run each cargo/pnpm/Tauri compile through `direnv exec . <command>` when Rust is involved. This slice is TypeScript/Svelte only.
- Long prose uses ASD-STE100. No agent attribution in commits or PRs.
- Svelte edits: use `svelte-file-editor` / Svelte MCP `svelte-autofixer` until clean.

## File map

| File | Role |
| --- | --- |
| `spdd/analysis/2026-11-21-properties-empty-state.md` | Slice analysis |
| `spdd/prompt/2026-11-21-properties-empty-state.md` | REASONS contract |
| `apps/desktop/src/components/EmptyState.svelte` | Shared empty-state UI |
| `apps/desktop/src/components/Inspector.svelte` | Properties wiring |
| `apps/desktop/src/app.css` | Inspector fills the properties column so empty state can centre |
| `docs/handbook/scene.md` | One sentence for empty Properties |
| `docs/evaluation/properties-empty-state/` | Before/after screenshots |
| `docs/superpowers/specs/2026-11-21-properties-empty-state-design.md` | Mark status approved |

## Review Focus

1. No selection → Properties body shows the exact guidance string; heading and Help remain.
2. With a selection → Properties fields match today (no empty state).
3. Empty state is muted, centred text only — no icon or badge.
4. Help with no selection still opens topic `scene`.

---

### Task 1: Slice contract

**Files:**
- Create: `spdd/analysis/2026-11-21-properties-empty-state.md`
- Create: `spdd/prompt/2026-11-21-properties-empty-state.md`
- Modify: `docs/superpowers/specs/2026-11-21-properties-empty-state-design.md` (status line)

**Interfaces:**
- Produces: requirement IDs R1–R5 that later commits cite.

- [ ] **Step 1: Write the analysis** at `spdd/analysis/2026-11-21-properties-empty-state.md`:

```markdown
# Properties empty state analysis

Date: 2026-11-21. Issue: [#286](https://github.com/danirukun/opensekai/issues/286). Spec: `docs/superpowers/specs/2026-11-21-properties-empty-state-design.md`.

## Intent

Properties shows a blank body when nothing is selected. The user needs a next action that names Assets.

## Current state

- `Inspector.svelte` renders the heading always. The body is inside `{#if entity && view.scene && marks}`.
- Selection comes from the Assets list (`Hierarchy.svelte` heading `Assets`).
- No shared empty-state component exists.

## Scope

In: shared `EmptyState`, Properties no-selection copy, handbook line, browser evidence.
Out: other panes, OBS URL sharing, `@oshi-connect/ui` promotion.
```

- [ ] **Step 2: Write the REASONS contract** at `spdd/prompt/2026-11-21-properties-empty-state.md`:

```markdown
# Properties empty state contract

Date 2026-11-21 · Issue #286 · Analysis: `spdd/analysis/2026-11-21-properties-empty-state.md`

## R: Requirements
- R1. When Properties has no selected entity, the body shows exactly: `Select an asset from Assets to view or edit its properties.`
- R2. The Properties heading and Help button stay visible with no selection. Help topic stays `scene` (existing `topicForKind(null)`).
- R3. When an entity is selected, Properties behaviour matches today (fields, sections, index, reset marks).
- R4. Empty-state look uses one shared `EmptyState` component: centred muted text, no icon, badge, or card.
- R5. Other panes may reuse `EmptyState` later; this slice wires Properties only.

## E: Entities
- `EmptyState` props: `{ message: string }`.

## A: Approach
- New Svelte component in `apps/desktop`. Inspector renders it in the `{:else}` of the entity body branch.
- Inspector fills the properties column height so the empty message can centre in the pane.

## S: Structure
- New: `EmptyState.svelte`, this analysis, this contract, evaluation screenshots folder.
- Changed: `Inspector.svelte`, `app.css` (inspector fill), `docs/handbook/scene.md`.

## O: Operations
- No new host commands. No new session API.

## N: Norms
- Copy restraint: one actionable sentence. No field helper text.
- STE for handbook and PR prose.

## S: Safeguards
- Browser check: empty and selected Properties.
- No unit test for the static string.
```

- [ ] **Step 3: Set design status** in `docs/superpowers/specs/2026-11-21-properties-empty-state-design.md` first line after the title to: `Date: 2026-11-21. Status: approved. Issue: …` (keep the issue links).

- [ ] **Step 4: Commit**

```bash
git add spdd/analysis/2026-11-21-properties-empty-state.md spdd/prompt/2026-11-21-properties-empty-state.md docs/superpowers/specs/2026-11-21-properties-empty-state-design.md
git commit -m "$(cat <<'EOF'
Add the Properties empty-state slice contract.

EOF
)"
```

---

### Task 2: EmptyState and Properties wiring

**Files:**
- Create: `apps/desktop/src/components/EmptyState.svelte`
- Modify: `apps/desktop/src/components/Inspector.svelte`
- Modify: `apps/desktop/src/app.css` (`.inspector` fill rules only)

**Interfaces:**
- Consumes: R1–R4 from Task 1
- Produces: `EmptyState` with `{ message: string }`; Inspector empty branch uses the fixed Properties message

- [ ] **Step 1: Create `EmptyState.svelte`** with this exact content:

```svelte
<script lang="ts">
 let {message}:{message:string}=$props();
</script>
<p class="empty-state">{message}</p>
<style>
 .empty-state{margin:0;flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px;text-align:center;font-size:12px;line-height:1.4;color:var(--ds-color-text-muted)}
</style>
```

- [ ] **Step 2: Run Svelte MCP `svelte-autofixer`** on that file. Fix until clean. Do not add icons or extra props.

- [ ] **Step 3: Make the inspector fill the properties column** so the empty message can centre. In `apps/desktop/src/app.css`, change the existing `.inspector{padding:20px 16px;max-width:980px}` rule to:

```css
.inspector{padding:20px 16px;max-width:980px;min-height:100%;display:flex;flex-direction:column;box-sizing:border-box}
```

Do not change other inspector rules.

- [ ] **Step 4: Wire Inspector.** In `apps/desktop/src/components/Inspector.svelte`:

1. Add import next to the other component imports:

```ts
 import EmptyState from './EmptyState.svelte';
```

2. Replace the body branch so the empty path uses `EmptyState`. Keep the heading row unchanged. Change only the block that starts with `{#if entity && view.scene && marks}`:

Keep the opening `{#if entity && view.scene && marks}` and all selected-entity markup as today. Change the closing `{/if}` that ends that block (immediately after `</div>` of `inspector-layout`, before the `view.error` alert) to:

```svelte
 {:else}
  <EmptyState message="Select an asset from Assets to view or edit its properties."/>
 {/if}
```

Leave the `view.error` alert after that block.

Do not change Help, sections, or field markup inside the selected branch.

- [ ] **Step 5: Run Svelte MCP `svelte-autofixer`** on `Inspector.svelte`. Fix only issues introduced by this change.

- [ ] **Step 6: Typecheck**

```bash
direnv exec . pnpm --filter @opensekai/desktop exec svelte-check --threshold error
```

Expected: PASS (or only pre-existing errors unrelated to EmptyState/Inspector). If the filter name differs, from `apps/desktop` run `direnv exec . pnpm exec svelte-check --threshold error`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/EmptyState.svelte apps/desktop/src/components/Inspector.svelte apps/desktop/src/app.css
git commit -m "$(cat <<'EOF'
Show Properties guidance when no asset is selected.

EOF
)"
```

---

### Task 3: Handbook and browser evidence

**Files:**
- Modify: `docs/handbook/scene.md`
- Create: `docs/evaluation/properties-empty-state/before.png` (capture before if still available; otherwise document that before was blank body under the heading)
- Create: `docs/evaluation/properties-empty-state/after.png`
- Create: `docs/evaluation/properties-empty-state/README.md` (short evidence note)

**Interfaces:**
- Consumes: R1–R3 behaviour from Task 2

- [ ] **Step 1: Update handbook.** In `docs/handbook/scene.md`, under `## Properties`, after the first paragraph, add:

```markdown
When no asset is selected, the Properties column says to select an asset from Assets.
```

- [ ] **Step 2: Browser check (constitution UI check).** Run the editor (existing desktop app or `direnv exec . pnpm --filter …` per project docs). On the Assets tab:

  1. Clear selection (`model.clearSelection` path: click empty area if available, or select then clear via the known clear-selection gesture / temporary console if needed). Confirm Properties shows the exact guidance string under the heading.
  2. Select any asset. Confirm fields show as today and the empty message is gone.
  3. Confirm Help with no selection still opens the scene handbook topic.

- [ ] **Step 3: Save screenshots** to `docs/evaluation/properties-empty-state/after.png` (empty Properties). Add `before.png` if you still have a blank-pane capture; otherwise write in the README that before was heading-only with a blank body.

- [ ] **Step 4: Write** `docs/evaluation/properties-empty-state/README.md`:

```markdown
# Properties empty state

Issue #286 section 1. Contract: `spdd/prompt/2026-11-21-properties-empty-state.md`.

| State | Evidence |
| --- | --- |
| No selection | [after.png](after.png) — guidance copy under Properties |
| Asset selected | Browser check: fields match pre-change behaviour |

Platform: macOS. Commit: record after the evidence commit.
```

- [ ] **Step 5: Commit**

```bash
git add docs/handbook/scene.md docs/evaluation/properties-empty-state/
git commit -m "$(cat <<'EOF'
Record Properties empty-state handbook and screenshots.

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec item | Task |
| --- | --- |
| Shared `EmptyState` in apps/desktop | Task 2 |
| Properties copy when no selection | Task 2 |
| Heading + Help unchanged; Help `scene` | Task 2 / Review Focus 4 |
| Muted centred text, no icon | Task 2 Step 1 |
| No unit test; browser + screenshots | Task 3 |
| Other panes / OBS / UI kit out of scope | Task 1 non-goals / R5 |

No placeholders. Types: `{ message: string }` only.
