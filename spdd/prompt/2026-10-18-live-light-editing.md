# REASONS: Live light editing

Date: 2026-10-18. Scope: bundle B12 (#45 ENV-07). Analysis: [live light editing](../analysis/2026-10-18-live-light-editing.md). Changes: [light entities](2026-10-17-light-entities.md) R4, R8, R13, R14; [Warudo editor interactions](2026-10-03-warudo-editor-interactions.md), the commit rule. Related: [camera navigation commits](../../packages/renderer/src/navigation-commits.ts).

The owner approved this scope on 2026-10-18 in the local session. Spot, ambient, and haze lights are bundle B13.

## R — Requirements

### Gizmo drag

R1. A gizmo gesture sends its draft through the normal patch route while the drag continues. One `createNavigationCommitter` serves each gesture. It sends one `setTransform` at most every 33 ms, and only after the reply to the previous one. Each send uses the revision of the previous reply (the first uses the revision at the gesture start). On release, the viewport offers the end pose if it differs from the last offered pose, and then finishes the committer. The persistent transform of each send is `persistentTransform(base, start, current)`, as today.
R2. A frame revision or a model revision that the gesture's own commits explain (`committer.owns(revision)`) does not cancel the gesture. Any other revision cancels it. A selection change, a disabled editor, or a tool change also cancels it. These cancels send nothing more.
R3. Escape, pointer cancel, lost pointer capture, canvas blur, and window blur cancel the gesture by user action. If no commit was sent, the cancel sends nothing. If a commit was sent, the cancel sends one last commit with the persistent transform of the gesture start (`base`). In both cases the root goes back to its start pose, and `onDraft(null)` is called.
R4. A failed send (a CONFLICT or another error) ends the gesture without a retry. The root goes back to the authoritative state on the next frame.
R5. After the last commit, the dragged root stays on its committed pose (`frozen` is true) until a frame or a model scene with that revision or a later one arrives, or until a new gesture starts.
R6. The viewport handle has `draftTransform(id): Transform | null`. During a gesture it returns the persistent draft of the dragged entity. While the root settles (R5), it returns the committed transform. Otherwise it returns `null`.
R7. Before the renderer applies the lights of a frame, it replaces the transform of each entity that has a draft (R6). Thus the three.js light of a dragged light entity, and its shadow, follow the gizmo on each preview frame. Other renderers (OBS, the Editor window preview) draw each committed pose.
R8. The Scene window calls `model.setTransform(..., live = true)` for each send, so that the model does not reject the next send as BUSY. The Scene window keeps the viewport enabled while the model has a live edit pending. It sends `refresh` to the Editor window once, when the gesture ends, not after each send.

### Directional light (changes light entities R4, R8, R14)

R9. A directional light keeps its direction from its rotation (−Z). Its three.js `target` is at the entity position, and the light is at the entity position − 50 m × the direction. The 20 m × 20 m shadow box (0.5 m to 100 m) is thus centered on the entity position. The light entity defaults (R10 of light entities) do not change.
R10. When a directional light has its shadow on, its editor helper draws the outline of the shadow box: a 20 m × 20 m square at the light position, normal to the direction, in the light color. A point light helper does not change. The helper stays in the editor viewport only.

### Inspector controls (changes light entities R13)

R11. `ColorField` shows a native `<input type="color">` swatch and the hex text field. An `input` event on the swatch sends the color as a live edit (R13). A `change` event ends the live edit. The hex field commits on `change` as today, with the same validation (`parseLightColor`).
R12. `SliderField` shows a label, a native `<input type="range">`, and a compact number field. Its props are the value, `min`, `max`, `step`, a curve (`linear` or `cubic`), an optional slider end `sliderMax` (≤ `max`), and `disabled`. Slider movement sends live edits (R13). The `change` event or the pointer release of the slider ends the live edit. The number field commits on `change` through the existing commit path, with the hard `min` and `max`. A value above `sliderMax` is accepted, and the slider stays at its end. While the user drags, the field shows the dragged value, not the scene value. After the end, it shows the scene value again after the next scene change, or after 500 ms.
R13. A live edit uses `createLiveEdit`. It keeps the latest request, has at most one request in flight, waits at least 16 ms between sends, and sends with `live = true`. A selection change or a foreign revision cancels the requests that are not sent yet, and reports CONFLICT for a foreign revision. A failed send cancels the requests that are not sent yet, and reports the error code. `createLiveTransform` keeps its interface and its behavior, as a wrapper.
R14. The model flag `transformPending` becomes `livePending`. `setLight`, `setEnvironmentReflections`, `setCameraLens` (via `onlens`), `setCameraNavigation`, `setTrackingSmoothing`, and the expression fade setter take a `live` argument. A field is not disabled by a pending live edit.
R15. Fields:
- Light Intensity: cubic, 0–1000, slider end 10 for a directional light and 100 for a point light, step 0.01.
- Light Range: cubic, 0–1000, slider end 50, step 0.1.
- Shadow Intensity: linear, 0–1, step 0.01.
- Bias: linear, −0.01–0.01, step 0.0001.
- Normal Bias: linear, 0–1, step 0.01.
- Color: `ColorField`.
- Reflections Intensity: linear, 0–2, step 0.01.
- Control Sensitivity: linear, 0.1–10, step 0.1.
- FOV: linear, 1–179, step 1. It is a live slider; Near and Far keep their number fields and Apply.
- Tracking Min cutoff and Derivative cutoff: cubic, 0.01–120, slider end 20, step 0.01.
- Tracking Beta: cubic, 0–100, slider end 10, step 0.001.
- Tracking Smoothing has no Apply button. Reset stays.
- Expression Fade: linear, 0–5 s, step 0.1.
R16. Transform scrub labels, Blueprint node fields, Blueprint variables, and the clip planes do not change. No new UI text is added beyond the field labels (constitution principle 1).

### Documents

R17. `ARCHITECTURE.md` "Command path" says that a gizmo gesture commits through the committer at most every 33 ms with a last commit on release. `docs/warudo-parity.md` records only the verified subset. Light entities R4, R8, R13, and R14 and the commit rule of Warudo editor interactions refer to this contract.

## E — Entities

- `EditorHandle` (viewport) adds `draftTransform(id: Id): Transform | null`. `EditorOptions` adds `onGestureEnd?(): void`.
- `LiveRequest = { entityId: Id; send(revision: number): Promise<Reply<{ revision: number }>>; matches?(entity: SceneEntity | undefined): boolean }`.
- `createLiveEdit(model, onError, onPending) → { offer(request): boolean; end(): void; cancel(): void; close(): void }`.
- `EditorView.livePending?: boolean` replaces `transformPending`.
- `SliderRange = { min: number; max: number; step: number; curve: 'linear' | 'cubic'; sliderMax?: number }` with `toSlider(value, range): number` (0–1) and `fromSlider(t, range): number`.

## A — Approach

Write the pure parts first, each with a unit test: slider mapping, `createLiveEdit`, the draft substitution, and the directional placement. Then the viewport committer and its tests. Then the renderer, the Scene window, and the components. Then the fields. Check on macOS with the running build, MCP, computer use, and the OBS WebSocket.

## S — Structure

- `packages/renderer/src/editor-viewport.ts`, `renderer.ts`, `scene-lights.ts`; tests `editor-viewport.test.ts`, `scene-lights.test.ts`.
- `apps/desktop/src/App.svelte`, `EditorApp.svelte`; `editor/live-edit.ts` (new), `live-transform.ts`, `model.ts`, `slider.ts` (new); `components/SliderField.svelte` (new), `ColorField.svelte` (new), `LightFields.svelte`, `EnvironmentFields.svelte`, `CameraLensFields.svelte`, `CameraNavigationFields.svelte`, `TrackingSmoothingFields.svelte`, `TrackingAdvanced.svelte`, `AvatarExpressionFields.svelte`, `Inspector.svelte`; tests `slider.test.ts` (new), `live-edit.test.ts` (new), `live-transform.test.ts`, `editor-model.test.ts`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/live-light-editing.md` (new), the two changed contracts.

## O — Operations

1. Slider mapping (`slider.ts`) with tests: linear and cubic round trip, step rounding, a value above `sliderMax`, and the ends.
2. `createLiveEdit` with tests (latest only, one in flight, the 16 ms wait, selection cancel, foreign revision, failed send). `createLiveTransform` as a wrapper; its tests pass without change except the flag name.
3. `scene-lights.ts`: R9, and a test that a second `apply` with a new position moves the point light, and moves the target of a directional light. A pure `withDrafts(entities, draft)` with a test.
4. Viewport: R1 to R6, with tests: throttled sends, one commit for a drag with one move, a last commit on release, own revisions do not cancel, a foreign revision cancels, Escape after a send reverts, Escape before a send sends nothing, and `draftTransform`.
5. Renderer and Scene window: R7, R8, R10.
6. Components and fields: R11 to R16.
7. macOS check, evidence, parity, and architecture (R17).

## N — Norms

- Unit tests for the pure logic: slider mapping, live helper, draft substitution, directional placement, and the viewport gesture states. No unit tests for static copy.
- The evidence for the look, the live motion, and OBS is the running build on macOS (owner rule: no scratch harness page).
- Functional TypeScript and plain data. Controls come from `@oshi-connect/ui`; the slider and the swatch are native inputs, as the checkboxes are.

## S — Safeguards

- Do not add an edit path that skips the patch route. Every live step is a `scenePatch`.
- Do not draw a helper in the OBS output.
- Do not change the contracts, the Rust mirror, the show file, or the quality profiles.
- A cancel by the user leaves the scene as it was at the gesture start.
- Do not claim the OBS frame rate during a drag or the macOS color picker event timing before they are measured.
