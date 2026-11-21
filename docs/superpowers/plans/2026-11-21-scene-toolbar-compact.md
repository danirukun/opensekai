# Scene Toolbar Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the scene viewer top toolbar height from 48px toward about 24px without dropping controls or clipping them.

**Architecture:** CSS densify on `.scene-toolbar` in `apps/desktop/src/app.css`, plus Lucide icon size 17 → 14 in `ScenePane.svelte`. No markup restructure. If 24px clips, raise only as far as needed (cap ~28px) and record the measured height with screenshots.

**Tech Stack:** Svelte 5, `apps/desktop/src/app.css` design tokens, Lucide icons, pnpm, browser check for UI evidence.

**Spec:** `docs/superpowers/specs/2026-11-21-scene-toolbar-compact-design.md`

## Global Constraints

- Target height: about 24px. Raise only if clipped; keep at or under about 28px.
- Height only. Keep `Scene` title and current control order (transform tools, selection name, guides, perf, preview, help).
- Do not change `.show-toolbar`, `.blueprint-toolbar`, or the editor rail.
- Constitution principles 1 and 2: no new helper text, pills, badges, or cards.
- No unit test for layout CSS. Verify in the browser. PR gets before/after screenshots and measured height.
- Svelte 5. Functional TypeScript. Comment only hard logic.
- Long prose uses ASD-STE100. No agent attribution in commits or PRs.
- Svelte edits: use `svelte-file-editor` / Svelte MCP `svelte-autofixer` until clean.
- Run Rust compiles through `direnv exec . <command>` when needed. This slice is CSS/Svelte only.

## File map

| File | Role |
| --- | --- |
| `spdd/analysis/2026-11-21-scene-toolbar-compact.md` | Slice analysis |
| `spdd/prompt/2026-11-21-scene-toolbar-compact.md` | REASONS contract |
| `apps/desktop/src/app.css` | `.scene-toolbar` density |
| `apps/desktop/src/components/ScenePane.svelte` | Toolbar icon size 14 |
| `docs/evaluation/scene-toolbar-compact/` | Before/after screenshots + measured height |
| `docs/superpowers/specs/2026-11-21-scene-toolbar-compact-design.md` | Approved design |

## Review Focus

1. Toolbar computed height is about 24px (or documented raise ≤28px).
2. All toolbar controls remain visible and clickable with no clipping.
3. Control set and order unchanged; `Scene` title remains.
4. `.show-toolbar` and `.blueprint-toolbar` heights unchanged.

---

### Task 1: Slice contract

**Files:**
- Create: `spdd/analysis/2026-11-21-scene-toolbar-compact.md`
- Create: `spdd/prompt/2026-11-21-scene-toolbar-compact.md`

**Interfaces:**
- Produces: requirement IDs R1–R5 that later commits cite.

- [ ] **Step 1: Write the analysis** at `spdd/analysis/2026-11-21-scene-toolbar-compact.md`:

```markdown
# Scene toolbar compact analysis

Date: 2026-11-21. Issue: [#327](https://github.com/danirukun/opensekai/issues/327). Spec: `docs/superpowers/specs/2026-11-21-scene-toolbar-compact-design.md`.

## Intent

The scene viewer top toolbar is 48px tall. The owner wants about half that height so the preview gets more vertical space.

## Current state

- `ScenePane.svelte` renders `header.scene-toolbar` above `.viewport`.
- `app.css` sets `.scene-toolbar{height:48px}` and toolbar buttons `min-height:30px` with `padding:6px 8px`.
- Toolbar icons use Lucide `size={17}`. `HelpButton` uses its own 16px icon and local padding overrides.
- `.show-toolbar` is already denser at 38px; out of scope for this slice.

## Scope

In: scene toolbar CSS density, ScenePane toolbar icon size, browser evidence.
Out: horizontal trim, blueprint/show toolbars, shared density tokens.
```

- [ ] **Step 2: Write the REASONS contract** at `spdd/prompt/2026-11-21-scene-toolbar-compact.md`:

```markdown
# Scene toolbar compact contract

Date 2026-11-21 · Issue #327 · Analysis: `spdd/analysis/2026-11-21-scene-toolbar-compact.md`

## R: Requirements
- R1. `.scene-toolbar` height is about 24px (half of 48). If controls clip, raise only as far as needed and keep at or under about 28px.
- R2. Transform tools, selection name, guides, performance monitor, preview toggle, and help stay visible, usable, and unclipped.
- R3. The `Scene` title and control order stay as they are today.
- R4. Do not change `.show-toolbar`, `.blueprint-toolbar`, or the editor rail in this slice.
- R5. PR includes before/after screenshots and the measured toolbar height.

## E: Entities
- No new entities. Existing `ScenePane` header and CSS classes only.

## A: Approach
- Densify `.scene-toolbar` and its button rules in `app.css`.
- Drop Lucide toolbar icons in `ScenePane.svelte` from 17 to 14.
- Browser-check height and clipping; raise height only if needed.

## S: Structure
- New: this analysis, this contract, `docs/evaluation/scene-toolbar-compact/`.
- Changed: `apps/desktop/src/app.css`, `apps/desktop/src/components/ScenePane.svelte`.

## O: Operations
- No new host commands. No new session API.

## N: Norms
- Height only. No new UI copy. STE for PR prose.

## S: Safeguards
- Browser check of toolbar height and each control.
- No unit test for CSS layout.
```

- [ ] **Step 3: Commit**

```bash
git add spdd/analysis/2026-11-21-scene-toolbar-compact.md spdd/prompt/2026-11-21-scene-toolbar-compact.md
git commit -m "$(cat <<'EOF'
Add the scene toolbar compact slice contract.

EOF
)"
```

---

### Task 2: Densify toolbar CSS and icons

**Files:**
- Modify: `apps/desktop/src/app.css` (`.scene-toolbar` block on the long editor line that also defines `.scene-pane`)
- Modify: `apps/desktop/src/components/ScenePane.svelte` (toolbar Lucide `size` values only)

**Interfaces:**
- Consumes: R1–R4 from Task 1.
- Produces: compact toolbar styles and 14px toolbar icons ready for browser check.

- [ ] **Step 1: Capture a before screenshot** of the Assets/scene view with the current 48px toolbar visible. Save as `docs/evaluation/scene-toolbar-compact/before.png` (create the directory). If the app is not running yet, take this screenshot in Task 3 Step 1 before applying CSS — in that case leave this step until then and do not commit an empty folder.

Preferred order for implementers who already have the editor open: screenshot first, then edit.

- [ ] **Step 2: Update `.scene-toolbar` density** in `apps/desktop/src/app.css`.

Inside the existing `.scene-pane`…`.viewport`… rule cluster, replace these substrings exactly:

From:
```css
.scene-toolbar{height:48px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid var(--ds-color-border);background:var(--ds-color-toolbar)}.scene-title{font-size:12px;font-weight:600;margin-right:10px}.tool-group{display:flex;gap:2px}.scene-toolbar button{padding:6px 8px;min-height:30px;border-radius:4px;font-size:12px}
```

To:
```css
.scene-toolbar{height:24px;flex:none;display:flex;align-items:center;gap:6px;padding:0 8px;border-bottom:1px solid var(--ds-color-border);background:var(--ds-color-toolbar)}.scene-title{font-size:12px;font-weight:600;margin-right:6px}.tool-group{display:flex;gap:2px}.scene-toolbar button{padding:2px 4px;min-height:20px;border-radius:4px;font-size:12px}
```

Do not edit `.show-toolbar` or `.blueprint-toolbar`. Leave `.scene-toolbar button.active-tool` and `.selection-name` unchanged.

- [ ] **Step 3: Drop toolbar icon sizes** in `apps/desktop/src/components/ScenePane.svelte`.

Replace every Lucide `size={17}` in the `header.scene-toolbar` markup with `size={14}`. That is these icons: `Move`, `RotateCw`, `Scaling`, `Grid3x3`, `Activity`, `Eye`, `EyeOff` (both branches of the preview toggle).

Do not change `HelpButton` (it uses size 16 and its own styles). Do not change context-menu icons outside the header.

- [ ] **Step 4: Run Svelte autofixer** on `ScenePane.svelte` via Svelte MCP / `svelte-file-editor` until clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app.css apps/desktop/src/components/ScenePane.svelte
git commit -m "$(cat <<'EOF'
Densify the scene viewer top toolbar.

EOF
)"
```

---

### Task 3: Browser check and evidence

**Files:**
- Create: `docs/evaluation/scene-toolbar-compact/before.png` (if not already from Task 2)
- Create: `docs/evaluation/scene-toolbar-compact/after.png`
- Create: `docs/evaluation/scene-toolbar-compact/README.md`

**Interfaces:**
- Consumes: densified toolbar from Task 2.
- Produces: R5 evidence for the PR.

- [ ] **Step 1: Run the desktop editor** (existing local flow; typically `direnv exec . pnpm --filter @opensekai/desktop …` or the project’s usual Tauri/dev command from `apps/desktop`). Open the Assets/scene view so `header.scene-toolbar` is visible.

- [ ] **Step 2: Measure height** in DevTools: select `.scene-toolbar` and record computed `height`. Expected: `24px`. If icons or buttons clip, or hit targets are unusable, raise `.scene-toolbar{height:…}` in steps of 2px up to `28px`, keep button rules as densified, re-measure, and note the final value in the README.

- [ ] **Step 3: Click-check each control** — Move, Rotate, Scale, Guides menu, Perf toggle, Preview toggle, Help. Confirm nothing is clipped and each action still works.

- [ ] **Step 4: Confirm out-of-scope bars** — `.show-toolbar` still 38px; `.blueprint-toolbar` still 48px (open Blueprints panel if needed).

- [ ] **Step 5: Save after screenshot** to `docs/evaluation/scene-toolbar-compact/after.png`. Ensure `before.png` exists (capture from git history / a pre-change run if Task 2 already landed; otherwise capture before by checking out the parent commit for a one-shot screenshot, then return to the branch).

- [ ] **Step 6: Write** `docs/evaluation/scene-toolbar-compact/README.md`:

```markdown
# Scene toolbar compact evidence

Issue: [#327](https://github.com/danirukun/opensekai/issues/327).

| | Height |
| --- | --- |
| Before | 48px |
| After | 24px |

Replace the After value if the implementer raised the bar (max 28px). Attach `before.png` and `after.png` in this folder. PR summary cites these files and the measured height.
```

- [ ] **Step 7: Commit**

```bash
git add docs/evaluation/scene-toolbar-compact/
git commit -m "$(cat <<'EOF'
Record scene toolbar compact screenshots and height.

EOF
)"
```

---

## Self-review (plan author)

1. **Spec coverage:** Goals (≈24px, usable controls, keep title/order, screenshots) → Tasks 2–3. Non-goals (no horizontal trim, no other toolbars) → R3/R4 and Task 3 Step 4. Icon size → Task 2 Step 3.
2. **Placeholders:** None. Exact CSS substrings and icon list included.
3. **Consistency:** Height target and raise cap match the design doc; files match the file map.
