# Instant Icon Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give kit `Button` a near-instant `tooltip` prop and convert the editor rail plus scene/show toolbar icon buttons so tips appear without the OS `title` delay.

**Architecture:** Extend `@oshi-connect/ui` `Button` to wrap itself in the existing `Tooltip` when `tooltip` is set, and stop forwarding native `title` in that case. Snapshot the built kit into this OpenSekai worktree’s `.local/ui`. Swap `title` → `tooltip` only on the proof surface in `EditorApp.svelte` and `ScenePane.svelte`.

**Tech Stack:** Svelte 5, `@oshi-connect/ui` (sibling repo `oshi-connect-ui`), Vitest + Testing Library, pnpm, `scripts/bootstrap-ui.ts`.

**Spec:** `docs/superpowers/specs/2026-11-21-instant-icon-tooltips-design.md`

## Global Constraints

- Icon-only / unlabeled controls only on the proof surface. Do not add tips that only repeat a visible label.
- Use kit `Tooltip`. Do not add a second tooltip primitive in OpenSekai.
- When `tooltip` is set, do not set native `title` on the same control.
- If both `tooltip` and `title` are passed, `tooltip` wins and `title` is ignored.
- Proof surface only: rail icons, Open/Save, scene toolbar icons. Leave `HelpButton`, Hierarchy row actions, blueprint icon `<button>`s, and labeled buttons alone.
- No SPDD slice contract in this spike.
- Constitution principles 1 and 2: no new helper text, pills, badges, or cards.
- Long prose uses ASD-STE100. No agent attribution in commits or PRs.
- Svelte edits: use `svelte-file-editor` / Svelte MCP `svelte-autofixer` until clean.
- Kit work happens in `/Users/danirukun/ghq/github.com/oshi-connect/oshi-connect-ui` on a dedicated branch. OpenSekai work stays in this worktree: `/Users/danirukun/ghq/github.com/oshi-connect/opensekai/.worktrees/instant-tooltips`.
- Verify `pwd` before Git operations. Do not use `git -C` or compound `cd` commands.
- Run each cargo / pnpm / Tauri compile that needs the Nix env through `direnv exec . <command>` from the OpenSekai worktree.

## File map

| File | Role |
| --- | --- |
| `oshi-connect-ui/src/lib/components/Button.svelte` | Add `tooltip`; wrap with `Tooltip` |
| `oshi-connect-ui/src/lib/components/__tests__/Button.test.ts` | Unit tests for `tooltip` |
| `oshi-connect-ui/src/lib/components/Tooltip.svelte` | Unchanged; consumed by `Button` |
| OpenSekai `.local/ui/` + `.local/ui-snapshot.json` | Generated kit snapshot (gitignored under `.local/`) |
| `docs/dependencies.md` | Expected UI source commit pin |
| `apps/desktop/src/EditorApp.svelte` | Rail + Open/Save `title` → `tooltip` |
| `apps/desktop/src/components/ScenePane.svelte` | Scene toolbar `title` → `tooltip` |
| `docs/superpowers/specs/2026-11-21-instant-icon-tooltips-design.md` | Approved design |

## Review Focus

1. Hover on rail / scene toolbar shows a tip without the long OS delay.
2. Keyboard focus shows the same tip.
3. Disabled Open/Save still shows a tip (wrapper receives pointer events).
4. Labeled buttons and out-of-scope icon controls are unchanged.
5. Kit tests cover `tooltip` rendering and absent native `title`.

---

### Task 1: Kit `Button` `tooltip` prop

**Files:**
- Modify: `/Users/danirukun/ghq/github.com/oshi-connect/oshi-connect-ui/src/lib/components/__tests__/Button.test.ts`
- Modify: `/Users/danirukun/ghq/github.com/oshi-connect/oshi-connect-ui/src/lib/components/Button.svelte`

**Interfaces:**
- Consumes: existing `Tooltip` with `text?: string` and `children: Snippet`
- Produces: `Button` prop `tooltip?: string`. When set, the rendered tree includes `role="tooltip"` and the `<button>` has no `title` attribute.

- [ ] **Step 1: Create a kit branch from an up-to-date main**

```bash
pwd
# Expected: .../oshi-connect/oshi-connect-ui
git fetch origin
git checkout main
git pull --ff-only
git checkout -b feat/button-tooltip
```

If the checkout is already dirty on another branch, stash or finish that work first. Do not build the tip on top of unrelated kit work.

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/components/__tests__/Button.test.ts`:

```ts
	it('renders a tooltip when tooltip text is set', () => {
		render(Button, { props: { tooltip: 'Assets' } });
		expect(screen.getByRole('tooltip').textContent).toBe('Assets');
	});

	it('omits native title when tooltip is set', () => {
		render(Button, { props: { tooltip: 'Assets', title: 'ignored' } });
		const button = screen.getByRole('button');
		expect(button.getAttribute('title')).toBeNull();
		expect(screen.getByRole('tooltip').textContent).toBe('Assets');
	});

	it('keeps native title when tooltip is absent', () => {
		render(Button, { props: { title: 'Assets' } });
		expect(screen.getByRole('button').getAttribute('title')).toBe('Assets');
		expect(screen.queryByRole('tooltip')).toBeNull();
	});
```

- [ ] **Step 3: Run the Button tests and confirm the new ones fail**

```bash
pwd
pnpm test -- src/lib/components/__tests__/Button.test.ts
```

Expected: FAIL on the new cases (`tooltip` unknown / no `role="tooltip"`).

- [ ] **Step 4: Implement `tooltip` on `Button`**

In `src/lib/components/Button.svelte`:

1. Import `Tooltip` from `./Tooltip.svelte`.
2. Add `tooltip?: string` to `Props` and destructure it next to `title`.
3. Render as follows (keep existing variant/size/loading markup inside the button):

```svelte
{#snippet control(nativeTitle: string | undefined)}
	<button
		{type}
		class={cn(base, variants[variant], sizes[size], className)}
		title={nativeTitle}
		disabled={busy}
		aria-busy={loading}
		aria-expanded={ariaExpanded}
		aria-haspopup={ariaHaspopup}
		onclick={onclick}
	>
		{#if loading}
			<Spinner
				size={spinnerSize}
				variant={variant === 'ghost' ? 'primary' : 'inherit'}
				aria-hidden={true}
			/>
		{/if}
		{@render children?.()}
	</button>
{/snippet}

{#if tooltip}
	<Tooltip text={tooltip}>
		{@render control(undefined)}
	</Tooltip>
{:else}
	{@render control(title)}
{/if}
```

Run Svelte MCP `svelte-autofixer` on `Button.svelte` until clean.

- [ ] **Step 5: Re-run Button tests**

```bash
pwd
pnpm test -- src/lib/components/__tests__/Button.test.ts
```

Expected: PASS (all Button tests).

- [ ] **Step 6: Commit in the kit repo**

```bash
pwd
git add src/lib/components/Button.svelte src/lib/components/__tests__/Button.test.ts
git commit -m "$(cat <<'EOF'
Add instant tooltip prop to Button.

EOF
)"
```

---

### Task 2: Snapshot the kit into this OpenSekai worktree

**Files:**
- Generate: `.local/ui/` and `.local/ui-snapshot.json` (under `.local/`, gitignored)
- Modify: `docs/dependencies.md` (expected UI source commit line)

**Interfaces:**
- Consumes: built kit `dist/` from `OPENSEKAI_UI_SOURCE`
- Produces: `file:../../.local/ui` that exports `Button` with `tooltip?: string`

- [ ] **Step 1: Build the kit package**

```bash
pwd
# Expected: .../oshi-connect/oshi-connect-ui on feat/button-tooltip
pnpm build
```

Expected: `dist/` updates without errors.

- [ ] **Step 2: Record the kit commit**

```bash
pwd
git rev-parse HEAD
```

Copy the full SHA. Use it in Step 4.

- [ ] **Step 3: Bootstrap the snapshot into the OpenSekai worktree**

```bash
pwd
# Expected: .../opensekai/.worktrees/instant-tooltips
OPENSEKAI_UI_SOURCE=/Users/danirukun/ghq/github.com/oshi-connect/oshi-connect-ui node scripts/bootstrap-ui.ts
direnv exec . pnpm install
```

Expected: `.local/ui-snapshot.json` lists the kit SHA from Step 2. `pnpm install` links `@oshi-connect/ui` from `.local/ui`.

- [ ] **Step 4: Update the expected commit in `docs/dependencies.md`**

Replace the “Expected source commit” value on the UI dependency paragraph with the SHA from Step 2. Keep the rest of the paragraph.

- [ ] **Step 5: Commit the pin doc in OpenSekai**

```bash
pwd
git add docs/dependencies.md
git commit -m "$(cat <<'EOF'
Pin the UI kit commit for Button tooltip.

EOF
)"
```

---

### Task 3: Convert the proof surface to `tooltip`

**Files:**
- Modify: `apps/desktop/src/EditorApp.svelte` (rail + Open/Save buttons)
- Modify: `apps/desktop/src/components/ScenePane.svelte` (scene toolbar icon buttons)

**Interfaces:**
- Consumes: `@oshi-connect/ui` `Button` with `tooltip?: string`
- Produces: proof-surface icon buttons use `tooltip=...` and no `title=`

- [ ] **Step 1: Swap rail and show-toolbar props in `EditorApp.svelte`**

Change only these controls (keep `sr-only` text):

```svelte
  <Button variant="ghost" class={panel==='assets'?'active-panel':''} tooltip="Assets" onclick={()=>{panel='assets';}}><OpenSekaiMark/><span class="sr-only">Assets</span></Button>
  <Button variant="ghost" class={panel==='output'?'active-panel':''} tooltip="Output" onclick={()=>{panel='output';}}><Radio size={20}/><span class="sr-only">Output</span></Button>
  <Button variant="ghost" class={panel==='blueprints'?'active-panel':''} tooltip="Blueprints" onclick={()=>{panel='blueprints';}}><Workflow size={20}/><span class="sr-only">Blueprints</span></Button>
  <!-- spacer unchanged -->
  <Button variant="ghost" class={panel==='resources'?'active-panel':''} tooltip="Resources" onclick={()=>{panel='resources';}}><PackageOpen size={20}/><span class="sr-only">Resources</span></Button>
  <Button variant="ghost" class={panel==='settings'?'active-panel':''} tooltip="Settings" onclick={()=>{panel='settings';}}><Settings size={20}/><span class="sr-only">Settings</span></Button>
```

And in the show toolbar:

```svelte
<Button variant="ghost" tooltip="Open show" disabled={!canEdit||!available||showBusy||view.pending||guideFor!==null} onclick={openShow}><FolderOpen size={16}/></Button>
<Button variant="ghost" tooltip="Save show (⇧ Save As)" disabled={!canEdit||!available||showBusy||view.pending} onclick={(event:MouseEvent)=>{void saveShow(event.shiftKey);}}><Save size={16}/></Button>
```

Leave the session-mark `title={sessionLabel}` alone (not a button tip).

- [ ] **Step 2: Swap scene toolbar props in `ScenePane.svelte`**

```svelte
  <Button variant="ghost" class={tool==='translate'?'active-tool':''} tooltip="Move (W)" disabled={!canEdit||!available} onclick={()=>ontool('translate')}><Move size={14}/><span class="sr-only">Move</span></Button>
  <Button variant="ghost" class={tool==='rotate'?'active-tool':''} tooltip="Rotate (E)" disabled={!canEdit||!available} onclick={()=>ontool('rotate')}><RotateCw size={14}/><span class="sr-only">Rotate</span></Button>
  <Button variant="ghost" class={tool==='scale'?'active-tool':''} tooltip="Scale (R)" disabled={!canEdit||!available} onclick={()=>ontool('scale')}><Scaling size={14}/><span class="sr-only">Scale</span></Button>
```

And the trailing icons:

```svelte
<Button variant="ghost" class={guidesOn(guides)?'active-tool':''} tooltip="Guides" aria-haspopup="menu" aria-expanded={menu?.guides===true} onclick={guideMenu}><Grid3x3 size={14}/><span class="sr-only">Guides</span></Button>
<Button variant="ghost" class={perfVisible?'active-tool':''} tooltip={perfVisible?'Hide performance monitor':'Show performance monitor'} onclick={onperftoggle}><Activity size={14}/><span class="sr-only">{perfVisible?'Hide performance monitor':'Show performance monitor'}</span></Button>
<Button variant="ghost" class={previewOn?'active-tool':''} tooltip={previewOn?'Turn off preview':'Turn on preview'} onclick={onpreviewtoggle}>{#if previewOn}<Eye size={14}/>{:else}<EyeOff size={14}/>{/if}<span class="sr-only">{previewOn?'Turn off preview':'Turn on preview'}</span></Button>
```

Do not change `HelpButton`.

Run `svelte-autofixer` on both edited Svelte files until clean.

- [ ] **Step 3: Typecheck the desktop app**

```bash
pwd
direnv exec . pnpm --filter @opensekai/desktop check
```

Expected: PASS (or only pre-existing errors unrelated to `tooltip`).

- [ ] **Step 4: Commit the proof surface**

```bash
pwd
git add apps/desktop/src/EditorApp.svelte apps/desktop/src/components/ScenePane.svelte
git commit -m "$(cat <<'EOF'
Use instant Button tooltips on the rail and scene toolbar.

EOF
)"
```

---

### Task 4: Browser check on the proof surface

**Files:**
- None required (evidence optional under `docs/evaluation/` only if you capture screenshots)

**Interfaces:**
- Consumes: running desktop editor with the new `.local/ui` snapshot

- [ ] **Step 1: Start the desktop editor**

```bash
pwd
direnv exec . pnpm --filter @opensekai/desktop tauri dev
```

Wait until the window is up. Use the existing local session path for this machine.

- [ ] **Step 2: Check hover tips**

1. Hover each left-rail icon (Assets, Output, Blueprints, Resources, Settings). Tip must appear quickly (no long OS delay).
2. Hover Open and Save. Tip must appear quickly.
3. On the Assets panel, hover Move / Rotate / Scale / Guides / perf / preview. Tip must appear quickly.

- [ ] **Step 3: Check focus and disabled**

1. Tab to a rail button; tip shows on focus.
2. With Open or Save disabled (busy/unavailable state if easy to reach), hover the control; tip still shows via the wrapper.

- [ ] **Step 4: Confirm out-of-scope unchanged**

Labeled buttons (for example Start screen “Add character”) still have no tip. `HelpButton` still uses its previous `title` behavior for this spike.

- [ ] **Step 5: Stop the app when done**

No commit required unless you add evaluation screenshots. If you add screenshots, put them under `docs/evaluation/instant-icon-tooltips/` and commit with a short note.

---

## Spec coverage check

| Spec item | Task |
| --- | --- |
| Kit `Button` `tooltip` wraps with `Tooltip` | Task 1 |
| No native `title` when `tooltip` set; `tooltip` wins over `title` | Task 1 |
| Snapshot / link kit into OpenSekai | Task 2 |
| Rail + Open/Save + scene toolbar convert | Task 3 |
| Kit unit tests | Task 1 |
| Desktop hover/focus/disabled browser check | Task 4 |
| Out of scope left alone | Tasks 3–4 |
