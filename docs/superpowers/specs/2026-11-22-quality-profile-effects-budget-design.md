# Quality profile effects budget

Date: 2026-11-22. Status: implemented (this branch). Related: [#343](https://github.com/danirukun/opensekai/issues/343) look stack, [SHOW-05 / #72](https://github.com/danirukun/opensekai/issues/72) quality profiles, parent [physical lens design](./2026-11-21-camera-physical-lens-design.md). Figma: [OpenSekai-UI · Quality presets board](https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai-UI?node-id=92-10).

## Intent

Make the existing Output Quality profiles (`preview_v1`, `production_v1`, `performance_v1`) the single place that sets the look-stack budget (DoF / flare / anamorphic cheap vs full), in the same way Warudo uses a global quality preset. Do not add a Settings surface or a per-camera quality control in this slice.

## Current state

- `QUALITY_PROFILES` in `packages/contracts/src/quality.ts` stores `resolutionScale`, `maxTextureSize`, and `msaaSamples` only.
- Output panel `Select` labeled Quality sets the OBS URL `?quality=` value (`OutputControls.svelte` + `qualityOptions`).
- `lookQuality(profileId)` in `packages/renderer/src/lens-look.ts` maps **only** `preview_v1` → `cheap`; `production_v1` and `performance_v1` → `full`.
- Cheap/full already drives bokeh scale, DoF range, flare downsample, and anamorphic tap count. Per-effect `highQuality` still gates through `effectQuality`.

## Decisions (owner, 2026-11-22)

| Topic | Decision |
| --- | --- |
| Placement | **A** — Expand Output Quality (not Settings, not per-camera) |
| Scope this slice | Effects budget only (not shadows, LOD, or preview rate) |
| UI | Select only — no readout, no expandable details |
| Cheap profiles | `preview_v1` **and** `performance_v1` |
| Full profile | `production_v1` |
| Encoding | Explicit `effectsQuality: 'cheap' \| 'full'` on each `QUALITY_PROFILES` entry; keep the same profile IDs |
| Approach | **1** — Table field + `lookQuality` adapter |
| Demo scene | Queued after this slice |

## Goals

1. Each quality profile names its look-stack budget in the frozen table.
2. `lookQuality(id)` reads `QUALITY_PROFILES[id].effectsQuality` (same `(QualityProfileId) => LookQuality` signature).
3. Performance OBS / editor runs that use `performance_v1` cheapen DoF / flare / anamorphic the same way Preview does.
4. Production stays full look quality.
5. Output Quality UI and `?quality=` strings do not change.
6. Unit tests and SHOW-05 / parity text match the new Performance behavior.

## Non-goals

- Shadows, LOD, texture filtering beyond `maxTextureSize`, or preview frame-rate knobs in a profile.
- New Output helper text or an effects-budget readout.
- Per-camera effect-tier UI (per-effect `highQuality` flags stay as they are).
- New profile IDs (`*_v2`).
- Effects demo / fixture scene (separate brainstorm after this).

## Data model

In `packages/contracts/src/quality.ts`, extend `QualityProfile`:

```ts
effectsQuality: 'cheap' | 'full'
```

| Profile | resolutionScale | maxTextureSize | msaaSamples | effectsQuality |
| --- | --- | --- | --- | --- |
| `preview_v1` | 0.5 | 1024 | 4 | cheap |
| `production_v1` | 1 | 2048 | 4 | full |
| `performance_v1` | 1 | 1024 | 0 | cheap |

**Versioning note.** The comment “a changed value needs a new ID” still applies to the numeric knobs. `effectsQuality` is a **new** field. It formalizes look-stack budget that lived only in `lookQuality` before. Performance’s look tier changes from implied full to cheap; keep the same IDs so OBS URLs stay stable. Record the behavior change in SHOW-05 / parity.

No show-document migration: quality lives on the output URL and runtime, not on entity JSON.

## Runtime

```ts
export const lookQuality = (profile: QualityProfileId): LookQuality =>
  QUALITY_PROFILES[profile].effectsQuality;
```

- `renderer.ts` keeps `lookQuality(quality.id)`.
- Cheap/full levers stay as in #343: DoF inputs, flare downsample / blur, anamorphic taps.
- `effectQuality(highQuality, lookTier)` is unchanged.
- Film grain stays on enable + its own high-quality flag.
- `appStatus` / frame ack still report the profile id only.

## Evidence

- Contracts unit test: table values for `effectsQuality` on all three profiles.
- Update `packages/renderer/test/lens-look.test.ts`: `lookQuality('performance_v1')` expects `'cheap'`.
- Keep existing cheap vs full look-stack unit coverage.
- Docs: quality-controls contract / SHOW-05 note; `docs/warudo-parity.md` SHOW-05; `ARCHITECTURE.md` only if it claims Performance runs full look quality.
- Optional local OBS check can wait for the effects demo scene.

## Out of scope / follow-up

1. **Effects demo scene** — fixture show with depth planes, bright lights, and bloom so DoF, flare, anamorphic, and grain are easy to judge under each profile.
2. Shadows / LOD / preview rate in `QUALITY_PROFILES` (remainder of SHOW-05).
3. Any second Quality surface in Settings.

## Open questions

None for this slice. Owner locked the decisions above on 2026-11-22.
