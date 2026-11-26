# Snow Feasibility Spike (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove on the running app that snow can fall in a box and build up on an MToon character with shelter, shedding, and melt, and measure its cost against the 2 ms budget.

**Architecture:** A new `snow` scene entity goes through the existing command route (contracts, session, MCP `scene_patch`). In each renderer, a sky pass writes the height of the first surface under the sky, an instanced sprite draws stateless flakes, and one compute pass for each avatar keeps a snow amount for each vertex. `CharacterMToonMaterial` reads that amount and draws the snow.

**Tech Stack:** TypeScript, zod, three.js 0.187 (`WebGPURenderer`, TSL, compute), `@pixiv/three-vrm` 3.5.5, Rust (`opensekai-contracts`), Vitest, pnpm, Tauri.

**Spec:** `docs/superpowers/specs/2026-11-26-snow-design.md`. Read it first. This plan implements slice 1 of its Slices section only.

## Global Constraints

- Follow `CLAUDE.md` and `ARCHITECTURE.md`. Do not add an edit path that skips the command route.
- Run each cargo, pnpm, or Tauri command that compiles Rust through `direnv exec . <command>`.
- Verify `pwd` before Git operations. Do not use `git -C` or compound `cd` commands. Do not push.
- Do not add an agent credit or a `Co-Authored-By` trailer to a commit.
- Write prose (docs, the slice contract, commit bodies) in ASD-STE100 Simplified Technical English.
- Functional TypeScript and plain data. Add a comment only when the logic is hard to follow without it.
- Flake motion comes from `frame.elapsedMs` only. No flake has state.
- The sky pass and the compute pass run inside the applied frame, so `gpuMs` includes them.
- No snow node, pass, or buffer exists in a scene without a Snow entity.
- Setting ranges and defaults, copied from the spec: `rate` 0 to 1 (0.5), `fallSpeed` 0.2 to 3 (1), `flakeSize` 0.5 to 2 (1), `flutter` 0 to 2 (1), `windDirection` 0 to 360 (0), `windSpeed` 0 to 5 (0), `buildUpSeconds` 5 to 600 (45), `meltSeconds` 5 to 600 (20), `thickness` 0 to 0.05 (0.015), `settleOnCharacters`, `settleOnProps`, `settleOnEnvironment` (true). At most 1 snow entity in a scene.
- Build-up constants, start values: up ramp starts at 0.35, sky band 0.02 m, slide 0.5 s, shed from 0.6 m/s to 2 m/s, shed 0.25 s.
- Start values of the full tier: 12,000 flakes at rate 1, sky target 512 × 512.
- Budget gate: snow on minus snow off, at most 2 ms p95 `gpuMs` and at most 0.5 ms `cpuMs`, OBS output, `production_v1`, 1920 × 1080 at 60 FPS, two performers, rate 1.

## Scope of this slice

In: the entity and `setSnow` in both contracts, the session operation, the sky pass, the flakes, the build-up compute, the snow surface on `CharacterMToonMaterial` (not its outline copy), renderer wiring on WebGPU, and evidence items 1, 2, and 6 of the spec.

Out (later slices of the spec): the session `cover` value and the warm start (slice 2), lilToon and outlines (slice 3), the static cap on props and environments and the effect of the settle flags on them (slice 4), Add › Snow, the Inspector section, the viewport helper, `snowRate`, and the handbook (slice 5), the tier adapter, the sparkle, the WebGL 2 static cap and its warning, `pipeline-blame`, the headless WebGPU integration test, and building the buffers in the load job (slice 6). In this slice a WebGL 2 client draws flakes and no build-up, and the buffers of an avatar are built on its first frame with snow.

## Review Focus

1. **Sky lookup is mirrored.** A prop above the left shoulder must keep the left shoulder clean, not the right one. Render-target UV origin differs between conventions. Test: Task 5 pins the camera against `skyMatrix`; Task 10 step 4 checks the side on the GPU.
2. **Two performers from one asset.** Each avatar needs its own state buffer. If two avatar instances share one material object, the second share replaces the first. Test: Task 9 asserts that two avatars get two shares and that no material holds the share of another avatar; Task 10 step 6 shakes one head only.
3. **An avatar with no skinned mesh, or a mesh with `bindMode` not `attached`.** Expected: no build-up for that mesh, no error, flakes still draw. Test: Task 7.
4. **The Snow entity or an avatar leaves the scene, or an avatar reloads, while snow is on.** Expected: buffers and targets are disposed, materials lose the snow nodes, and no stale offset reads another buffer. Test: Task 9.
5. **A long session.** At `elapsedMs` of 4 hours the flake position must stay in the box and finite. Test: Task 4.
6. **A steep surface that faces up.** The sky texel is about 1.2 cm at a 6 m box, so a slope can read as sheltered in bands. Expected: no visible stripes on the shoulders at the default box. Check: Task 10 step 3; tune `skyBand` there and record the value in the spec.

## File map

| File | Role |
| --- | --- |
| `spdd/analysis/2026-11-26-snow-spike.md`, `spdd/prompt/2026-11-26-snow-spike.md` | Slice requirements and REASONS contract |
| `packages/contracts/src/snow.ts` | `DEFAULT_SNOW` |
| `packages/contracts/src/schema.ts`, `types.ts`, `index.ts` | `SnowSettingsSchema`, the `snow` entity, `setSnow`, `LIMITS.snows` |
| `packages/contracts/test/snow.test.ts` | Contract tests |
| `fixtures/protocol/validation-vectors.json` | Five snow vectors |
| `crates/contracts/src/lib.rs`, `crates/contracts/tests/snow.rs` | Rust mirror |
| `packages/session/src/scene-ops.ts`, `packages/session/test/snow-patch.test.ts` | `setSnow` operation |
| `apps/desktop/src/editor/help.ts`, `asset-groups.ts`, `inspector-sections.ts` | The new kind compiles and shows in the Hierarchy |
| `apps/mcp/test/snow.integration.test.ts` | MCP can add and change snow |
| `packages/renderer/src/snow-math.ts` | Pure CPU reference |
| `packages/renderer/src/snow-sky.ts` | Sky pass |
| `packages/renderer/src/snow-flakes.ts` | Flakes |
| `packages/renderer/src/snow-build-up.ts` | Vertex data and compute for one avatar |
| `packages/renderer/src/snow-surface.ts` | Surface nodes |
| `packages/renderer/src/character-mtoon.ts` | Snow hook |
| `packages/renderer/src/snow.ts` | Facade |
| `packages/renderer/src/renderer.ts` | Wiring |
| `docs/evaluation/snow.md`, `docs/warudo-parity.md`, `ARCHITECTURE.md` | Evidence, status, map |

## Before Task 1

- [ ] Run `pwd`; it must be the worktree root. Run `pnpm i`, then `pnpm ensure:ui`.
- [ ] Run `pnpm check` and `pnpm test:unit`. Both must pass before any change. If one fails, stop and report.

---

### Task 1: Slice contract

**Files:**
- Create: `spdd/analysis/2026-11-26-snow-spike.md`
- Create: `spdd/prompt/2026-11-26-snow-spike.md`

- [ ] **Step 1: Write the analysis.** Use `spdd/analysis/2026-11-18-spring-bones.md` as the form. State the current code facts that this plan depends on: Haze is the model for a singleton entity (`schema.ts`, `scene-ops.ts`, `haze.ts`, `renderer.ts`); the spring clock (`spring-grid.ts`) gives the tick grid; `CharacterMToonMaterial` has `setupPosition`, `setupDiffuseColor`, `setupVariants`, and `customProgramCacheKey` from `MToonNodeMaterial` 3.5.5; the Catboy avatar has 57 meshes; `benchmark_start` gives p95 `gpuMs` and `cpuMs`.

- [ ] **Step 2: Write the REASONS contract.** Use `spdd/prompt/2026-11-18-spring-bones.md` as the form, with all seven sections. Decisions: copy the Decisions table and the "Changes after approval" table of the spec. Requirements: R1 the entity, its limit, and `setSnow` (Task 2, 3); R2 the pure math (Task 4); R3 the sky pass (Task 5); R4 the flakes (Task 6); R5 the build-up for each avatar (Task 7); R6 the surface on MToon and the compile rule (Task 8); R7 the frame order and disposal (Task 9); R8 the gate: evidence 1, 2, and 6 (Task 10). Copy the Scope and Review Focus sections of this plan.

- [ ] **Step 3: Commit**

```bash
git add spdd/analysis/2026-11-26-snow-spike.md spdd/prompt/2026-11-26-snow-spike.md
git commit -m "Specify the snow feasibility slice"
```

---

### Task 2: Contracts, TypeScript and Rust

**Files:**
- Create: `packages/contracts/src/snow.ts`, `packages/contracts/test/snow.test.ts`, `crates/contracts/tests/snow.rs`
- Modify: `packages/contracts/src/schema.ts` (near `HazeSettingsSchema`, the entity union, the scene limit check, the patch union, `LIMITS`), `packages/contracts/src/types.ts` (the entity union, `HazeSettings`, the `setHaze` member), `packages/contracts/src/index.ts`, `crates/contracts/src/lib.rs` (each place that names `Haze` or `SetHaze`), `fixtures/protocol/validation-vectors.json`

**Interfaces:**
- Produces: `SnowSettings` (the twelve fields of Global Constraints), `SnowSettingsSchema` (strict), `DEFAULT_SNOW: SnowSettings`, `LIMITS.snows = 1`, the entity member `{ kind: 'snow'; snow: SnowSettings }`, the patch op `{ kind: 'setSnow'; entityId: Id; snow: SnowSettings }`. Rust: `SnowSettings`, `SceneEntity::Snow`, `PatchOp::SetSnow`, `MAX_SNOWS`.

- [ ] **Step 1: Write the failing TypeScript test** in `packages/contracts/test/snow.test.ts`

```ts
import { expect, it } from 'vitest';
import { DEFAULT_SNOW, LIMITS, PatchOpSchema, SceneViewSchema, SnowSettingsSchema, makeSmokeScene, type SceneEntity } from '@opensekai/contracts';

const snow = (id: string, patch: object = {}): SceneEntity => ({ id, name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW, ...patch } } as SceneEntity);

it('has the defaults of the design', () => {
    expect(DEFAULT_SNOW).toEqual({ rate: 0.5, fallSpeed: 1, flakeSize: 1, flutter: 1, windDirection: 0, windSpeed: 0, buildUpSeconds: 45, meltSeconds: 20, thickness: 0.015, settleOnCharacters: true, settleOnProps: true, settleOnEnvironment: true });
    expect(SnowSettingsSchema.safeParse(DEFAULT_SNOW).success).toBe(true);
});
it.each([['rate', -0.1], ['rate', 1.1], ['fallSpeed', 0.1], ['fallSpeed', 3.1], ['flakeSize', 0.4], ['flakeSize', 2.1], ['flutter', 2.1], ['windDirection', 361], ['windSpeed', 5.1], ['buildUpSeconds', 4], ['buildUpSeconds', 601], ['meltSeconds', 4], ['meltSeconds', 601], ['thickness', 0.06], ['settleOnProps', 1]])('rejects %s = %s', (key, value) => {
    expect(SnowSettingsSchema.safeParse({ ...DEFAULT_SNOW, [key]: value }).success).toBe(false);
});
it('rejects an unknown field', () => expect(SnowSettingsSchema.safeParse({ ...DEFAULT_SNOW, color: '#fff' }).success).toBe(false));
it('allows one snow in a scene and rejects two', () => {
    const scene = makeSmokeScene();
    expect(LIMITS.snows).toBe(1);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, snow('snow_1')] }).success).toBe(true);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, snow('snow_1'), snow('snow_2')] }).success).toBe(false);
});
it('parses setSnow and rejects a bad group', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setSnow', entityId: 'snow_1', snow: DEFAULT_SNOW }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setSnow', entityId: 'snow_1', snow: { ...DEFAULT_SNOW, thickness: 1 } }).success).toBe(false);
});
```

If the patch union has another export name than `PatchOpSchema`, use the name that `packages/contracts/test/stage-lights.test.ts` uses for `setHaze`.

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/contracts/test/snow.test.ts`. Expected: FAIL, `DEFAULT_SNOW` is not exported.

- [ ] **Step 3: Implement the TypeScript contract.** Add each item of Interfaces next to its Haze counterpart, in the same style. `DEFAULT_SNOW` goes in `packages/contracts/src/snow.ts` as a frozen object and is exported from `index.ts`. Do not change `property-registry.ts` or `blueprint-file.ts` (slice 5).

- [ ] **Step 4: Run it.** Same command. Expected: PASS.

- [ ] **Step 5: Add five vectors** to `fixtures/protocol/validation-vectors.json`, each a copy of its Haze counterpart with the entity or operation replaced: `snow` (copy of `haze`; the entity is `snow('snow_1')` above; valid), `snow-two` (copy of `haze-two`; `INVALID_INPUT`), `snow-rate-over-limit` (copy of `haze-density-over-limit`; `rate` 1.5), `set-snow` (copy of `set-haze`, target `wireText`; valid), `set-snow-bad-thickness` (copy of `set-haze-bad-intensity`; `thickness` 0.06).

- [ ] **Step 6: Write the failing Rust test** `crates/contracts/tests/snow.rs`. Follow the haze tests in `crates/contracts/tests/stage_lights.rs`. Three tests: `snow_settings_round_trip_with_camel_case_names` (serialize the default group and compare with the JSON of `DEFAULT_SNOW`, including `fallSpeed`, `buildUpSeconds`, `settleOnCharacters`), `snow_settings_reject_each_range` (the same out-of-range values as Step 1, each gives a validation error), `scene_rejects_two_snows`.

- [ ] **Step 7: Run it.** `direnv exec . cargo test -p opensekai-contracts --test snow`. Expected: compile error, no `SnowSettings`.

- [ ] **Step 8: Implement the Rust mirror.** In `crates/contracts/src/lib.rs` add `MAX_SNOWS`, `SnowSettings` with the `object!` macro (wire names in camelCase, as `LightSettings` does for `affectCharacters`), `impl Validate for SnowSettings` with the message `"invalid snow"`, `SceneEntity::Snow`, `PatchOp::SetSnow`, the `"too many snows"` check, and an arm in each `match` that has a `Haze` or `SetHaze` arm.

- [ ] **Step 9: Run all contract checks.** `direnv exec . cargo test -p opensekai-contracts` and `pnpm vitest run --project unit packages/contracts`. Expected: PASS, including `vectors.rs` and `schema.test.ts` with the five new vectors.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts crates/contracts fixtures/protocol/validation-vectors.json
git commit -m "Add the snow entity and setSnow to the contracts"
```

---

### Task 3: Session operation, editor compile sites, and MCP

**Files:**
- Modify: `packages/session/src/scene-ops.ts` (next to the `setHaze` case), `apps/desktop/src/editor/help.ts` (`KIND_TOPICS`), `apps/desktop/src/editor/asset-groups.ts`, `apps/desktop/src/editor/inspector-sections.ts`
- Create: `packages/session/test/snow-patch.test.ts`, `apps/mcp/test/snow.integration.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `scenePatch` accepts `createEntity` with a snow entity and `setSnow`.

- [ ] **Step 1: Write the failing session test.** Copy the first three tests of `packages/session/test/haze-patch.test.ts` into `snow-patch.test.ts` and change them to snow: `creates a snow and replaces its group with setSnow`; `rejects setSnow on another kind or an unknown entity without a change` (`INVALID_INPUT` with the message `Entity is not a snow` for `performer`, `NOT_FOUND` for `nobody`, `INVALID_INPUT` for `thickness: 1`); `rejects a second snow through createEntity`.

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/session/test/snow-patch.test.ts`. Expected: FAIL on `setSnow`.

- [ ] **Step 3: Implement** the `setSnow` case in `scene-ops.ts`, as the `setHaze` case.

- [ ] **Step 4: Editor compile sites.** `help.ts`: `snow: 'environment'` in `KIND_TOPICS`. `asset-groups.ts`: a snow entity shows in the `environment` group. `inspector-sections.ts`: `if(entity.kind==='snow')return [transform];`. Add no other UI.

- [ ] **Step 5: Write the MCP integration test** `apps/mcp/test/snow.integration.test.ts`. Reason for the level: it crosses the stdio process boundary, and MCP is the only control of this slice. Follow the haze case of `apps/mcp/test/stage-lights.integration.test.ts`: call `scene_patch` with `createEntity` (the `snow_1` entity of Task 2), then with `setSnow` and `rate: 1`; each reply is ok, and the scene read back has `kind: 'snow'` with `rate: 1`.

- [ ] **Step 6: Run the checks.** `pnpm check`, `pnpm vitest run --project unit packages/session apps/desktop`, `pnpm vitest run --project integration apps/mcp/test/snow.integration.test.ts`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/session apps/desktop/src/editor apps/mcp/test/snow.integration.test.ts
git commit -m "Apply setSnow in the session and show the snow kind in the editor"
```

---

### Task 4: `snow-math.ts`

**Files:**
- Create: `packages/renderer/src/snow-math.ts`, `packages/renderer/test/snow-math.test.ts`

**Interfaces:**
- Consumes: `SpringClock`, `planSpringSteps` from `./spring-grid`; `Vec3`, `Quat`, `SnowSettings` from `@opensekai/contracts`.
- Produces:

```ts
export const SNOW = { upStart: 0.35, skyBand: 0.02, slideSeconds: 0.5, shedStart: 0.6, shedFull: 2, shedSeconds: 0.25, maskEdge: 0.1 } as const;
export const SNOW_FLAKES = 12_000;
export const SNOW_SKY_SIZE = 512;
/** Linear RGB. */
export const SNOW_COLOR: Vec3;   // [0.92, 0.95, 1]
export const SNOW_SHADE: Vec3;   // [0.62, 0.7, 0.85]
export const smoothstep: (edge0: number, edge1: number, x: number) => number;
export const upFacing: (normalY: number) => number;
export const skyExposure: (height: number, skyHeight: number) => number;
export interface BuildUpInput { amount: number; up: number; sky: number; speed: number; rate: number; buildUpSeconds: number; meltSeconds: number; seconds: number }
export const buildUpStep: (input: BuildUpInput) => number;
export const snowMask: (amount: number, noise: number) => number;
export type FlakeMotion = Pick<SnowSettings, 'fallSpeed' | 'flutter' | 'windDirection' | 'windSpeed'>;
/** Box-local metres, each axis in [-size/2, size/2). `seed` has three values in [0, 1). */
export const flakePosition: (seed: Vec3, elapsedSeconds: number, size: Vec3, motion: FlakeMotion) => Vec3;
/** The yaw of an entity rotation, in radians. */
export const boxYaw: (rotation: Quat) => number;
/** Column-major 4 × 4: world → (u, v, height above the box bottom in metres, 1). */
export const skyMatrix: (position: Vec3, yaw: number, scale: Vec3) => number[];
export const snowSteps: (previous: SpringClock | null, current: SpringClock) => { reset: boolean; seconds: number };
```

- [ ] **Step 1: Write the failing test** `packages/renderer/test/snow-math.test.ts`

```ts
import { expect, it, describe } from 'vitest';
import { Matrix4, Vector4 } from 'three/webgpu';
import { SNOW, boxYaw, buildUpStep, flakePosition, skyExposure, skyMatrix, snowMask, snowSteps, upFacing } from '../src/snow-math';

const base = { amount: 0, up: 1, sky: 1, speed: 0, rate: 1, buildUpSeconds: 45, meltSeconds: 20, seconds: 1 / 60 };
const still = { fallSpeed: 1, flutter: 0, windDirection: 0, windSpeed: 0 };
const clock = (tick: number, resets = 0, sessionId = 's') => ({ sessionId, tick, elapsedMs: tick * 1000 / 60, resets });

describe('exposure', () => {
    it('ramps the up term from 0.35 to 1', () => {
        expect(upFacing(0.2)).toBe(0); expect(upFacing(SNOW.upStart)).toBe(0); expect(upFacing(1)).toBe(1);
        expect(upFacing(0.7)).toBeGreaterThan(upFacing(0.5));
    });
    it('is 1 at the sky surface and 0 at 2 cm below it', () => {
        expect(skyExposure(1, 1)).toBe(1); expect(skyExposure(1.5, 1)).toBe(1);
        expect(skyExposure(0.98, 1)).toBe(0); expect(skyExposure(0.99, 1)).toBeCloseTo(0.5, 6);
    });
});
describe('build-up step', () => {
    it('grows by rate / buildUpSeconds under open sky and is full after buildUpSeconds', () => {
        expect(buildUpStep(base)).toBeCloseTo(1 / 2700, 9);
        let amount = 0;
        for (let i = 0; i < 2700; i++) amount = buildUpStep({ ...base, amount });
        expect(amount).toBeGreaterThan(0.999);
    });
    it('stays 0 under shelter and on a surface that does not face up', () => {
        expect(buildUpStep({ ...base, sky: 0 })).toBe(0);
        expect(buildUpStep({ ...base, up: 0 })).toBe(0);
    });
    it('slides off a surface that does not face up, with a time constant of 0.5 s', () => {
        expect(buildUpStep({ ...base, amount: 1, up: 0 })).toBeCloseTo(1 - 1 / 30, 6);
        expect(buildUpStep({ ...base, amount: 1, up: 0, seconds: 0.5 })).toBe(0);
    });
    it('keeps snow at 0.6 m/s and sheds it at 2 m/s with a time constant of 0.25 s', () => {
        expect(buildUpStep({ ...base, amount: 1, speed: 0.6 })).toBe(1);
        expect(buildUpStep({ ...base, amount: 1, speed: 2 })).toBeCloseTo(1 + 1 / 2700 - 4 / 60, 6);
        expect(buildUpStep({ ...base, amount: 1, speed: 9 })).toBeCloseTo(1 + 1 / 2700 - 4 / 60, 6);
    });
    it('melts by 1 / meltSeconds while the rate is 0', () => {
        expect(buildUpStep({ ...base, amount: 1, rate: 0, seconds: 1 })).toBeCloseTo(0.95, 6);
        expect(buildUpStep({ ...base, amount: 0.01, rate: 0, seconds: 1 })).toBe(0);
    });
});
describe('mask', () => {
    it('is 0 at amount 0 and 1 at amount 1 for each noise value', () => {
        for (const noise of [0, 0.5, 1]) { expect(snowMask(0, noise)).toBe(0); expect(snowMask(1, noise)).toBe(1); }
        expect(snowMask(0.5, 0.5)).toBeCloseTo(0.5, 6);
    });
});
describe('flakes', () => {
    const size = [6, 4, 6] as const, seed = [0.5, 0.5, 0.5] as const;
    it('gives the same position for the same seed and time, in the box, also after 4 hours', () => {
        for (const t of [0, 1, 1000, 14_400]) {
            const p = flakePosition([...seed], t, [...size], { ...still, flutter: 2, windSpeed: 5, windDirection: 30 });
            expect(p).toEqual(flakePosition([...seed], t, [...size], { ...still, flutter: 2, windSpeed: 5, windDirection: 30 }));
            p.forEach((value, axis) => { expect(Number.isFinite(value)).toBe(true); expect(Math.abs(value)).toBeLessThanOrEqual(size[axis]! / 2); });
        }
    });
    it('falls by fallSpeed × (0.75 + 0.5 × seed z) and drifts with the wind', () => {
        const a = flakePosition([...seed], 0, [...size], still), b = flakePosition([...seed], 0.1, [...size], still);
        expect(a[1] - b[1]).toBeCloseTo(0.1, 6); expect(b[0]).toBeCloseTo(a[0], 6);
        const c = flakePosition([...seed], 0.1, [...size], { ...still, windDirection: 90, windSpeed: 1 });
        expect(c[0] - a[0]).toBeCloseTo(0.1, 6); expect(c[2]).toBeCloseTo(a[2], 6);
    });
});
describe('sky matrix', () => {
    const map = (m: number[], x: number, y: number, z: number) => new Vector4(x, y, z, 1).applyMatrix4(new Matrix4().fromArray(m)).toArray().slice(0, 3);
    it('maps the box to u, v in 0 to 1 and the height above the box bottom', () => {
        const m = skyMatrix([0, 2, 0], 0, [6, 4, 6]);
        expect(map(m, 0, 4, 0)).toEqual([0.5, 0.5, 4]);
        expect(map(m, -3, 0, -3).map(v => +v.toFixed(6))).toEqual([0, 0, 0]);
        expect(map(m, 3, 4, 3).map(v => +v.toFixed(6))).toEqual([1, 1, 4]);
    });
    it('turns with the yaw of the box', () => {
        const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
        expect(boxYaw([...q])).toBeCloseTo(Math.PI / 2, 6);
        // With a yaw of 90°, the box +X axis points to world −Z.
        expect(map(skyMatrix([0, 2, 0], Math.PI / 2, [6, 4, 6]), 0, 0, -3).map(v => +v.toFixed(6))).toEqual([1, 0.5, 0]);
    });
});
describe('steps', () => {
    it('counts ticks as seconds and resets as the spring grid does', () => {
        expect(snowSteps(null, clock(5))).toEqual({ reset: true, seconds: 0 });
        expect(snowSteps(clock(5), clock(6))).toEqual({ reset: false, seconds: 1 / 60 });
        expect(snowSteps(clock(5), clock(8))).toEqual({ reset: false, seconds: 3 / 60 });
        expect(snowSteps(clock(5), clock(21))).toEqual({ reset: true, seconds: 0 });
        expect(snowSteps(clock(5), clock(6, 1))).toEqual({ reset: true, seconds: 1 / 60 });
        expect(snowSteps(clock(5), clock(5))).toEqual({ reset: false, seconds: 0 });
    });
});
```

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/renderer/test/snow-math.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `snow-math.ts`.** The tests fix most bodies. These three are the reference that the TSL code of Tasks 6 to 8 must repeat term for term:

```ts
export const buildUpStep = ({ amount, up, sky, speed, rate, buildUpSeconds, meltSeconds, seconds }: BuildUpInput): number => {
    const grow = rate / buildUpSeconds * up * sky;
    const melt = rate === 0 ? 1 / meltSeconds : 0;
    const decay = (up === 0 ? 1 / SNOW.slideSeconds : 0) + smoothstep(SNOW.shedStart, SNOW.shedFull, speed) / SNOW.shedSeconds;
    return Math.min(1, Math.max(0, amount + seconds * (grow - melt) - amount * Math.min(1, seconds * decay)));
};
export const snowMask = (amount: number, noise: number): number =>
    smoothstep(noise - SNOW.maskEdge, noise + SNOW.maskEdge, amount * (1 + 2 * SNOW.maskEdge) - SNOW.maskEdge);
export const flakePosition = (seed: Vec3, t: number, size: Vec3, { fallSpeed, flutter, windDirection, windSpeed }: FlakeMotion): Vec3 => {
    const angle = windDirection * Math.PI / 180, sway = 0.15 * flutter, turn = 2 * Math.PI;
    const wrap = (value: number, span: number) => ((value % span) + span) % span - span / 2;
    return [
        wrap(seed[0] * size[0] + Math.sin(angle) * windSpeed * t + Math.sin(t * (0.7 + seed[1]) + seed[2] * turn) * sway, size[0]),
        wrap(seed[1] * size[1] - fallSpeed * (0.75 + 0.5 * seed[2]) * t, size[1]),
        wrap(seed[2] * size[2] + Math.cos(angle) * windSpeed * t + Math.cos(t * (0.5 + seed[0]) + seed[1] * turn) * sway, size[2]),
    ];
};
```

`skyMatrix`: with the world point moved by `-position` and turned by `-yaw` into box axes `(x, y, z)`: `u = x / scale.x + 0.5`, `v = z / scale.z + 0.5`, `height = y + scale.y / 2`. `snowSteps` returns `{ reset: plan.reset, seconds: plan.fractions.length / 60 }` from `planSpringSteps`.

- [ ] **Step 4: Run it.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/snow-math.ts packages/renderer/test/snow-math.test.ts
git commit -m "Add the CPU reference of the snow math"
```

---

### Task 5: `snow-sky.ts`

**Files:**
- Create: `packages/renderer/src/snow-sky.ts`, `packages/renderer/test/snow-sky.test.ts`

**Interfaces:**
- Consumes: `skyMatrix`, `boxYaw`, `SNOW_SKY_SIZE`, `SNOW` from Task 4.
- Produces:

```ts
export const SNOW_SKY_LAYER = 13;
export type SnowEntity = Extract<SceneEntity, { kind: 'snow' }>;
export interface SnowSky {
    /** R: the height above the box bottom of the first surface under the sky, in metres. 0 where nothing is. */
    readonly height: Texture;
    readonly matrix: UniformNode<'mat4'>;
    readonly camera: OrthographicCamera;
    /** Places the camera and sets the matrix. No recompile. */
    update(entity: SnowEntity): void;
    /** Enables SNOW_SKY_LAYER on each object under each root, one time for each root. */
    markCasters(roots: readonly Object3D[]): void;
    render(renderer: WebGPURenderer, scene: Scene): Promise<void>;
    dispose(): void;
}
export function createSnowSky(size?: number): SnowSky;
/** TSL: x = inside the box (0 or 1) × the sky exposure of a world point. */
export const skyExposureNode: (sky: Pick<SnowSky, 'height' | 'matrix'>, world: Node<'vec3'>) => Node<'float'>;
```

- [ ] **Step 1: Write the failing test** `packages/renderer/test/snow-sky.test.ts` (no GPU)

```ts
import { expect, it } from 'vitest';
import { Matrix4, Mesh, Object3D, Vector3, Vector4 } from 'three/webgpu';
import type { SceneEntity } from '@opensekai/contracts';
import { DEFAULT_SNOW } from '@opensekai/contracts';
import { SNOW_SKY_LAYER, createSnowSky } from '../src/snow-sky';
import { skyMatrix } from '../src/snow-math';

const entity = (rotation = [0, 0, 0, 1]) => ({ id: 'snow_1', name: 'Snow', visible: true, transform: { position: [1, 2, -1], rotation, scale: [6, 4, 8] }, kind: 'snow', snow: { ...DEFAULT_SNOW } }) as Extract<SceneEntity, { kind: 'snow' }>;

it.each([[[0, 0, 0, 1]], [[0, Math.SQRT1_2, 0, Math.SQRT1_2]]])('frames the box so that a render-target lookup agrees with skyMatrix', rotation => {
    const sky = createSnowSky(64);
    sky.update(entity(rotation));
    const { camera } = sky;
    camera.updateMatrixWorld(true);
    const world = new Vector3(2.5, 3, -4);
    const ndc = world.clone().project(camera);
    // A render target is read with v = 1 − (ndc.y × 0.5 + 0.5), as the three.js shadow lookup does.
    const fromCamera = [ndc.x * 0.5 + 0.5, 1 - (ndc.y * 0.5 + 0.5)];
    const fromMatrix = new Vector4(world.x, world.y, world.z, 1).applyMatrix4(new Matrix4().fromArray(skyMatrix([1, 2, -1], rotation[1] === 0 ? 0 : Math.PI / 2, [6, 4, 8])));
    expect(fromCamera[0]).toBeCloseTo(fromMatrix.x, 5);
    expect(fromCamera[1]).toBeCloseTo(fromMatrix.y, 5);
    expect(camera.layers.mask).toBe(1 << SNOW_SKY_LAYER);
    expect(sky.matrix.value.toArray().map(v => +v.toFixed(6))).toEqual(skyMatrix([1, 2, -1], rotation[1] === 0 ? 0 : Math.PI / 2, [6, 4, 8]).map(v => +v.toFixed(6)));
    sky.dispose();
});
it('marks each object under a caster root one time and leaves other layers on', () => {
    const sky = createSnowSky(64), root = new Object3D(), child = new Mesh();
    root.add(child);
    sky.markCasters([root]);
    expect(child.layers.isEnabled(SNOW_SKY_LAYER)).toBe(true); expect(child.layers.isEnabled(0)).toBe(true);
    child.layers.disable(SNOW_SKY_LAYER);
    sky.markCasters([root]);
    expect(child.layers.isEnabled(SNOW_SKY_LAYER)).toBe(false);
    sky.dispose();
});
```

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/renderer/test/snow-sky.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createSnowSky`.**
  - Target: `new RenderTarget(size, size, { type: HalfFloatType, depthBuffer: true })`, linear filter.
  - Camera: `OrthographicCamera(-sx/2, sx/2, sz/2, -sz/2, 0, sy)` at the top centre of the box, `up` = the box −Z axis in world space, `lookAt` the bottom centre, `layers.set(SNOW_SKY_LAYER)`.
  - Override material: one unlit `MeshBasicNodeMaterial` with `colorNode = vec4(matrix.mul(vec4(positionWorld, 1)).z, 0, 0, 1)`. It must stay unlit, so the pass starts no shadow update.
  - `render`: save the render target, `scene.overrideMaterial`, and the clear colour; set the target and the override; clear to 0; `await renderer.renderAsync(scene, camera)`; restore all three in `finally`.
  - `skyExposureNode`: `c = matrix × vec4(world, 1)`; `inside` = 1 when `c.x`, `c.y` are in 0 to 1 and `c.z` ≥ 0; read `height` at `c.xy` with an explicit level 0 (the caller can be a compute or a vertex stage); result = `inside × smoothstep(h − SNOW.skyBand, h, c.z)`.
  - This is the method of the three.js example `webgpu_compute_particles_snow` (its `collisionCamera` and `collisionPosRT`).

- [ ] **Step 4: Run it.** Same command, then `pnpm --filter @opensekai/renderer check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/snow-sky.ts packages/renderer/test/snow-sky.test.ts
git commit -m "Add the snow sky pass"
```

---

### Task 6: `snow-flakes.ts`

**Files:**
- Create: `packages/renderer/src/snow-flakes.ts`, `packages/renderer/test/snow-flakes.test.ts`

**Interfaces:**
- Consumes: `SnowSky`, `skyExposureNode` (Task 5); `SNOW_FLAKES`, `boxYaw` (Task 4).
- Produces:

```ts
export const SNOW_LAYER = 12;
export interface SnowFlakes {
    readonly object: Sprite;
    update(entity: SnowEntity, elapsedSeconds: number): void;
    dispose(): void;
}
/** `tint` is the character fill colour of the renderer (`characterShare.fill`). */
export function createSnowFlakes(sky: SnowSky, tint: UniformNode<'color'>, count?: number): SnowFlakes;
```

- [ ] **Step 1: Write the failing test** `packages/renderer/test/snow-flakes.test.ts` (no GPU)

```ts
import { expect, it } from 'vitest';
import { Color } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { DEFAULT_SNOW, type SceneEntity } from '@opensekai/contracts';
import { SNOW_LAYER, createSnowFlakes } from '../src/snow-flakes';
import { createSnowSky } from '../src/snow-sky';

const entity = (patch: object = {}, visible = true) => ({ id: 'snow_1', name: 'Snow', visible, transform: { position: [1, 2, -1], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [6, 4, 8] }, kind: 'snow', snow: { ...DEFAULT_SNOW, ...patch } }) as Extract<SceneEntity, { kind: 'snow' }>;
const make = () => createSnowFlakes(createSnowSky(64), uniform(new Color(1, 1, 1)), 12_000);

it('draws on the snow layer only, with no shadow and no depth write, as premultiplied alpha', () => {
    const { object } = make();
    expect(object.layers.mask).toBe(1 << SNOW_LAYER);
    expect(object.castShadow).toBe(false); expect(object.frustumCulled).toBe(false); expect(object.name).toBe('snow-flakes');
    expect(object.material).toMatchObject({ transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true });
});
it('scales the flake count with the rate and hides with the entity', () => {
    const flakes = make();
    flakes.update(entity({ rate: 1 }), 0); expect(flakes.object.count).toBe(12_000); expect(flakes.object.visible).toBe(true);
    flakes.update(entity({ rate: 0.5 }), 0); expect(flakes.object.count).toBe(6_000);
    flakes.update(entity({ rate: 0 }), 0); expect(flakes.object.visible).toBe(false);
    flakes.update(entity({ rate: 1 }, false), 0); expect(flakes.object.visible).toBe(false);
});
it('takes the position and the yaw of the box and keeps a scale of 1', () => {
    const flakes = make();
    flakes.update(entity(), 0);
    expect(flakes.object.position.toArray()).toEqual([1, 2, -1]);
    expect(flakes.object.scale.toArray()).toEqual([1, 1, 1]);
    expect(flakes.object.quaternion.toArray().map(v => +v.toFixed(6))).toEqual([0, 0.707107, 0, 0.707107]);
});
```

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/renderer/test/snow-flakes.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createSnowFlakes`.** One `Sprite` with a `SpriteNodeMaterial` and `sprite.count`, as the particle sprite of the three.js example above.
  - Seed: three `hash()` values of `instanceIndex`.
  - `positionNode`: the `flakePosition` expression of Task 4 in TSL, with uniforms for the elapsed seconds, the box size (the entity scale), and the four motion settings.
  - Size: a radius of `0.012 × flakeSize × (0.5 + seed.x)` metres.
  - Sky cull: opacity × `skyExposureNode(sky, world position of the flake)`.
  - Opacity: `0.35 + 0.55 × seed.y`, × a soft round falloff from the sprite centre, × a fade from 1 at 15 m of view distance to 0.4 at 40 m.
  - Colour: `tint`, written premultiplied (`rgb × alpha`).
  - `update` writes the uniforms, the object transform, `count = Math.round(count × rate)`, and `visible = entity.visible && rate > 0`.

- [ ] **Step 4: Run it.** Same command and the renderer check. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/snow-flakes.ts packages/renderer/test/snow-flakes.test.ts
git commit -m "Add the snow flakes"
```

---

### Task 7: `snow-build-up.ts`

**Files:**
- Create: `packages/renderer/src/snow-build-up.ts`, `packages/renderer/test/snow-build-up.test.ts`

**Interfaces:**
- Consumes: `SnowSky`, `skyExposureNode` (Task 5); `SNOW` (Task 4).
- Produces:

```ts
export interface SnowVertexData {
    count: number;
    /** 4 floats for each vertex: the bind matrix of the mesh × the position, and w = 1. */
    position: Float32Array;
    /** 4 floats for each vertex: the bind matrix of the mesh × the normal (w = 0), normalized. */
    normal: Float32Array;
    /** 4 indices for each vertex, each plus the bone offset of its skeleton. */
    skinIndex: Uint32Array;
    skinWeight: Float32Array;
    skeletons: { skeleton: Skeleton; offset: number }[];
    bones: number;
    offsets: Map<SkinnedMesh, number>;
}
/** Pure. Skips a mesh that is not a SkinnedMesh or whose bindMode is not 'attached'. */
export function collectSkinned(root: Object3D): SnowVertexData;
export interface SnowUniforms { rate: UniformNode<'float'>; buildUpSeconds: UniformNode<'float'>; meltSeconds: UniformNode<'float'>; thickness: UniformNode<'float'> }
export interface SnowBuildUp {
    /** vec4 for each vertex: the previous world position, and w = the amount. */
    readonly state: StorageBufferAttribute;
    readonly count: number;
    step(renderer: WebGPURenderer, seconds: number, reset: boolean): void;
    /** Sets each amount to 0 at the next step. */
    clear(): void;
    dispose(): void;
}
/** Sets `userData.snowOffset` on each collected mesh. Returns null when the root has no collected vertex. */
export function createSnowBuildUp(root: Object3D, sky: SnowSky, uniforms: SnowUniforms): SnowBuildUp | null;
```

- [ ] **Step 1: Write the failing test** `packages/renderer/test/snow-build-up.test.ts` (no GPU). Build the fixture with three.js objects: a helper `skinned(vertices, skeleton, bindOffsetX)` that makes a `SkinnedMesh` with `position`, `normal` (0, 1, 0), `skinIndex`, `skinWeight` attributes and calls `mesh.bind(skeleton, new Matrix4().makeTranslation(bindOffsetX, 0, 0))`. Tests:

```ts
it('joins the skinned meshes of a root with vertex and bone offsets', () => {
    // A: 3 vertices on skeleton S1 (2 bones). B: 2 vertices on S1. C: 4 vertices on S2 (3 bones), all skin indices 1.
    const data = collectSkinned(root);
    expect(data.count).toBe(9); expect(data.bones).toBe(5);
    expect([...data.offsets.values()]).toEqual([0, 3, 5]);
    expect(data.skeletons.map(entry => entry.offset)).toEqual([0, 2]);
    expect([...data.skinIndex.slice(5 * 4, 5 * 4 + 4)]).toEqual([3, 3, 3, 3]);
});
it('bakes the bind matrix into the position and keeps the normal a unit vector', () => {
    // Mesh A has a bind offset of 2 on X and a first vertex at (1, 0, 0).
    expect([...data.position.slice(0, 4)]).toEqual([3, 0, 0, 1]);
    expect([...data.normal.slice(0, 4)]).toEqual([0, 1, 0, 0]);
});
it('skips a mesh without a skin and a mesh with a detached bind mode', () => {
    expect(collectSkinned(rootWithPlainMeshAndDetachedMesh).count).toBe(0);
    expect(createSnowBuildUp(rootWithPlainMeshAndDetachedMesh, createSnowSky(64), uniforms)).toBeNull();
});
it('gives each collected mesh its vertex offset and a state of 4 floats for each vertex', () => {
    const buildUp = createSnowBuildUp(root, createSnowSky(64), uniforms)!;
    expect([meshA, meshB, meshC].map(mesh => mesh.userData.snowOffset)).toEqual([0, 3, 5]);
    expect(buildUp.count).toBe(9); expect(buildUp.state.array.length).toBe(36);
    buildUp.dispose();
    expect(meshA.userData.snowOffset).toBeUndefined();
});
```

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/renderer/test/snow-build-up.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `collectSkinned`** and run the first three tests to green.

- [ ] **Step 4: Implement `createSnowBuildUp`.** Storage: `StorageBufferAttribute` for `state` (itemSize 4), the four vertex buffers of `SnowVertexData`, and one bones buffer of `bones × 16` floats. One compute node with `count` invocations:

```
m       = Σ k of skinWeight[i][k] × bones[skinIndex[i][k]]
world   = (m × position[i]).xyz
normal  = normalize((m × normal[i]).xyz)
up      = smoothstep(SNOW.upStart, 1, normal.y)
sky     = skyExposureNode(sky, world)
speed   = reset ? 0 : length(world − state[i].xyz) / seconds
amount  = clear ? 0 : buildUpStep(state[i].w, up, sky, speed, rate, buildUpSeconds, meltSeconds, seconds)   // Task 4, term for term
state[i] = vec4(world, amount)
```

`step` does nothing when `seconds` is 0 and `reset` is false. Otherwise it calls `skeleton.update()` for each skeleton, copies each `skeleton.boneMatrices` into the bones buffer at its offset, marks that buffer for upload, sets the `seconds`, `reset`, and `clear` uniforms, and calls `renderer.compute(node)`. If the storage of `mat4` elements does not compile, store the bones as four `vec4` for each matrix and build the matrix in the node. `dispose` deletes each `userData.snowOffset` and disposes the node and the buffers.

- [ ] **Step 5: Run it.** Same command and the renderer check. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/snow-build-up.ts packages/renderer/test/snow-build-up.test.ts
git commit -m "Add the snow build-up compute for one avatar"
```

---

### Task 8: `snow-surface.ts` and the MToon hook

**Files:**
- Create: `packages/renderer/src/snow-surface.ts`, `packages/renderer/test/snow-surface.test.ts`
- Modify: `packages/renderer/src/character-mtoon.ts`

**Interfaces:**
- Consumes: `SnowBuildUp.state`, `.count` (Task 7); `SNOW`, `SNOW_COLOR`, `SNOW_SHADE` (Task 4); `noiseVolume` from `./haze`.
- Produces:

```ts
export interface SnowShare { readonly state: StorageBufferAttribute; readonly count: number; readonly thickness: UniformNode<'float'>; readonly noise: Data3DTexture }
/** A 32³ tiling noise volume; one for each renderer. */
export const createSnowNoise: () => Data3DTexture;
/** False for an outline copy and for a material with blended transparency. */
export const snowEligible: (material: { isOutline?: boolean; transparent: boolean }) => boolean;
/** Vertex stage: the amount of this vertex, or 0 for an object without `userData.snowOffset`. */
export const snowAmount: (share: SnowShare) => Node<'float'>;
/** Fragment stage: the snow mask from the amount of the vertex stage and the noise at the rest position. */
export const snowMaskNode: (amount: Node<'float'>, share: SnowShare) => Node<'float'>;
// On CharacterMToonMaterial:
snow: SnowShare | null;
```

- [ ] **Step 1: Write the failing test** `packages/renderer/test/snow-surface.test.ts` (no GPU)

```ts
import { expect, it } from 'vitest';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes';
import { CharacterMToonMaterial } from '../src/character-mtoon';
import { createSnowNoise, snowEligible, type SnowShare } from '../src/snow-surface';

const share = (): SnowShare => ({ state: new StorageBufferAttribute(new Float32Array(12), 4), count: 3, thickness: uniform(0.015), noise: createSnowNoise() });
const key = (material: CharacterMToonMaterial) => material.customProgramCacheKey();

it('keeps the program key of a material without snow', () => {
    const material = new CharacterMToonMaterial();
    expect(material.snow).toBeNull();
    expect(key(material)).toBe(MToonNodeMaterial.prototype.customProgramCacheKey.call(material));
});
it('changes the program key when the material gets a share, and gives it back when the share goes', () => {
    const material = new CharacterMToonMaterial(), before = key(material);
    material.snow = share();
    expect(key(material)).not.toBe(before);
    material.snow = null;
    expect(key(material)).toBe(before);
});
it('gives no snow to an outline copy or to a blended material', () => {
    expect(snowEligible({ isOutline: false, transparent: false })).toBe(true);
    expect(snowEligible({ isOutline: true, transparent: false })).toBe(false);
    expect(snowEligible({ isOutline: false, transparent: true })).toBe(false);
    for (const flag of ['isOutline', 'transparent'] as const) {
        const material = new CharacterMToonMaterial();
        material[flag] = true;
        const before = key(material);
        material.snow = share();
        expect(key(material)).toBe(before);
    }
});
it('copies the share with the material', () => {
    const material = new CharacterMToonMaterial(), value = share();
    material.snow = value;
    expect(new CharacterMToonMaterial().copy(material).snow).toBe(value);
});
it('makes a small noise volume', () => expect(createSnowNoise().image).toMatchObject({ width: 32, height: 32, depth: 32 }));
```

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/renderer/test/snow-surface.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `snow-surface.ts`.**
  - `snowAmount`: read `state` as a read-only storage of `vec4` at `vertexIndex + offset`, where `offset` is a uniform that updates for each object from `object.userData.snowOffset` (−1 when it is missing); the result is `.w`, or 0 when the offset is below 0.
  - `snowMaskNode`: the `snowMask` expression of Task 4, with the noise from `texture3D(share.noise, positionGeometry × 6)`.

- [ ] **Step 4: Implement the hook in `CharacterMToonMaterial`.** Each part runs only when `this.snow && snowEligible(this)`.
  - `snow: SnowShare | null = null`; `copy` copies it.
  - `customProgramCacheKey()`: the parent key, plus `':snow'` when the hook is active.
  - `setupPosition(builder)`: before the parent call, add `normalLocal × share.thickness × amount` to `positionLocal`, and keep `amount` as a varying for the fragment stage.
  - `setupDiffuseColor(builder)`: after the parent call, mix `diffuseColor.rgb` to `SNOW_COLOR` by the mask.
  - `setupVariants()`: mix `shade` to `SNOW_SHADE` by the mask, and multiply `matcap` and `parametricRim` by `1 − mask`.

- [ ] **Step 5: Run it.** Same command, `pnpm vitest run --project unit packages/renderer/test/character-mtoon.test.ts`, and the renderer check. Expected: PASS, and the existing MToon tests do not change.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/snow-surface.ts packages/renderer/src/character-mtoon.ts packages/renderer/test/snow-surface.test.ts
git commit -m "Draw the snow amount on MToon character materials"
```

---

### Task 9: Facade and renderer wiring

**Files:**
- Create: `packages/renderer/src/snow.ts`, `packages/renderer/test/snow.test.ts`
- Modify: `packages/renderer/src/renderer.ts` (the `wanted` filter near line 354, the entity loop near line 371, the haze block near line 537, the `try` before `postChain.render` near line 601, the screenshot camera near line 661, `dispose` near line 322), `ARCHITECTURE.md`

**Interfaces:**
- Consumes: Tasks 4 to 8.
- Produces:

```ts
export interface SnowAvatar { id: string; root: Object3D; materials: readonly Material[]; clock: SpringClock }
export interface Snow {
    readonly flakes: Object3D;
    /** `casters` are the roots of the avatars, the props, and the environment. */
    update(entity: SnowEntity, elapsedSeconds: number, avatars: readonly SnowAvatar[], casters: readonly Object3D[]): void;
    /** The sky pass, then one build-up step for each avatar. Inside the applied frame. */
    render(renderer: WebGPURenderer, scene: Scene): Promise<void>;
    dispose(): void;
}
export function createSnow(options: { tint: UniformNode<'color'>; compute: boolean }): Snow;
```

- [ ] **Step 1: Write the failing test** `packages/renderer/test/snow.test.ts`. Use the mocks of `packages/renderer/test/haze.test.ts` (backend, assets, post chain); add `setRenderTarget`, `getRenderTarget`, `getClearColor`, `setClearColor`, `clear`, and `compute` to the mocked renderer. Facade tests use stub avatars: an `Object3D` root with one `SkinnedMesh` (the fixture helper of Task 7) and one `CharacterMToonMaterial`.

```ts
// Renderer level
it('adds the flakes for a snow entity, hides them with the entity, and removes them with the entity', ...);
    // scene.getObjectByName('snow-flakes') exists and is visible; with visible: false it is not visible; with no snow entity it is gone.
it('gives the snow entity no scene object and no asset request', ...);
    // applyFrame resolves, and resources.readAsset was not called.
it('renders the sky pass before the post chain or the direct draw, inside the frame', ...);
    // The first renderAsync call of the frame has an OrthographicCamera; it comes before ports.aa.render or the main renderAsync call.
it('draws the snow layer with the output camera', ...);
    // The camera of the main draw has SNOW_LAYER enabled and SNOW_SKY_LAYER disabled.
it('does not start a compute on WebGL 2', ...);
    // With the backend mock set to 'webgl2', renderer.compute is not called and the flakes are in the scene.
// Facade level
it('gives each avatar its own share and sets it on eligible MToon materials only', ...);
    // Two avatars: materialA.snow and materialB.snow are different shares with different state buffers; an outline material keeps null.
it('reports a material that two avatars use', ...);
    // The second avatar does not replace the share; update() does not throw; the material keeps the share of the first avatar.
it('steps each build-up by the clock of its avatar and resets on a teleport', ...);
    // Clocks tick 5 → 6: compute called one time for each avatar. resets 0 → 1: the reset uniform is 1.
it('clears the materials and the buffers when an avatar leaves, when the root of an avatar changes, and on dispose', ...);
    // material.snow is null, material.version increased, mesh.userData.snowOffset is undefined.
it('sets each amount to 0 when the entity is not visible', ...);
    // After update with visible: false, the next render steps with the clear uniform set and does not draw the sky pass again after that.
```

- [ ] **Step 2: Run it.** `pnpm vitest run --project unit packages/renderer/test/snow.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createSnow`.** It owns one `SnowSky`, one `SnowFlakes`, one noise volume, the `SnowUniforms`, and a map from avatar id to `{ root, buildUp, share, materials, previous clock }`.
  - `update`: write the uniforms from the entity; `sky.update`; `sky.markCasters(casters)`; `flakes.update`; reconcile the map (create for a new id or a changed root when `compute` is true and `settleOnCharacters` is true, dispose for a missing one). To set or remove a share: `material.snow = …; material.needsUpdate = true`, only for a `CharacterMToonMaterial` that passes `snowEligible`.
  - `render`: when the entity is visible, `await sky.render(...)`, then for each avatar `buildUp.step(renderer, steps.seconds, steps.reset)` with `snowSteps`. On the first frame after `visible` goes off, call `clear()` and one step, then do nothing until it is visible again.

- [ ] **Step 4: Wire `renderer.ts`.**
  - Exclude `snow` from `wanted` and skip it in the entity loop, as `fpsCounter`.
  - `camera.layers.enable(SNOW_LAYER)` on the output camera and on the screenshot camera.
  - After the haze block: find the snow entity in `drawn`. If it exists, create the facade one time (`createSnow({ tint: characterShare.fill, compute: backend === 'webgpu' })`), add `snow.flakes` to the scene, and call `update` with the installed avatars (`value.root`, `value.avatar.characters`, `springClock(frame, entity.id)`) and the caster roots (entities of kind `avatar`, `mesh`, and `environment` that have an object). If it does not exist, dispose the facade.
  - In the `try`, before `postChain.render`: `await snow?.render(renderer, scene)`.
  - Dispose it in `dispose`.

- [ ] **Step 5: Run the checks.** `pnpm vitest run --project unit packages/renderer`, `pnpm check`. Expected: PASS.

- [ ] **Step 6: Update `ARCHITECTURE.md`.** Add one short paragraph to the Output path: the `snow` entity (at most 1), the six modules and their order in a frame, the two layers (12 and 13), the rule that the nodes exist only with the entity, and the limits of this slice (MToon only, WebGPU only for build-up). Add `snow` operations to no other section.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/snow.ts packages/renderer/src/renderer.ts packages/renderer/test/snow.test.ts ARCHITECTURE.md
git commit -m "Run snow in the renderer frame"
```

---

### Task 10: Gate on the running app

**Files:**
- Create: `docs/evaluation/snow.md`
- Modify: `docs/superpowers/specs/2026-11-26-snow-design.md` (tier table, constants, status), `docs/warudo-parity.md` (ENV-10), `packages/renderer/src/snow-math.ts` (only if a constant changes)

Use the running app, MCP, and OBS, not a scratch page. Use the Catboy avatar (`avatar_7b7c689e4e2ad3e6f6fe6cdb615ffad76d81ff788fcf61e7b9473fa73e024373`); check `asset_list` first and do not import it again. Do not start a stream. Record the backend, the quality profile, the fixture revision, and the commit with each result.

- [ ] **Step 1: Build and start** from this worktree, immediately before the checks: `direnv exec . pnpm dev:desktop`. Check with `pgrep` that no other OpenSekai dev app runs first; if one runs, ask the owner before you continue.

- [ ] **Step 2: Add the scene through MCP.** One Catboy performer at the origin, and one `scene_patch` with `createEntity` for snow: position `[0, 2, 0]`, scale `[6, 4, 6]`, `rate: 1`, other values from `DEFAULT_SNOW`. Expected: flakes fall in the preview and in the OBS Browser Source, no `Pipeline compile failed` warning is in `app_status`, the Hierarchy shows Snow in the Environment group, and the Inspector shows its Transform section. Record the time of the first frame with snow (the one-time buffer build and compile).

- [ ] **Step 3: Evidence 1, build-up and shelter.** Wait 45 s. Take `camera_screenshot` images from the front, the side, and above. Expected: snow on the top of the head, the shoulders, and (with a VMC pose from `pnpm evaluate:vmc-feed` that holds one arm out) the arm; no snow under the fringe and under the held-out arm; no stripes on the shoulders. If stripes show, change `SNOW.skyBand`, run the Task 4 tests, and record the value.

- [ ] **Step 4: Sky side check (Review Focus 1).** Add a box prop 0.3 m above the left shoulder with `scene_patch`, set the snow `visible` off and on, and wait 45 s. Expected: the left shoulder stays clean and the right shoulder has snow. If the sides are swapped, the `v` rule of `skyMatrix` is wrong for this backend: fix `skyMatrix` and the Task 5 test together.

- [ ] **Step 5: Evidence 2, shed, melt, clear.** With full snow: play a head shake with the tracking feed; the head loses its snow and the shoulders keep it. Set `rate: 0`; the flakes stop and the snow is gone in about 20 s. Set `rate: 1`, wait, then set `visible: false`; flakes and snow go at once. Take a screenshot at each state. Check the same three states in the OBS source.

- [ ] **Step 6: Two performers (Review Focus 2).** Add a second Catboy. Shake one head. Expected: only that head loses its snow.

- [ ] **Step 7: Evidence 6, budget.** Read `docs/evaluation/benchmark-contract.md`. OBS Browser Source at `?quality=production_v1`, default output format, two performers, preview off. Run `benchmark_start` three times with the snow `visible` off and three times with it on at `rate: 1` (30 s warm-up, 120 s measured each), and read each summary with `benchmark_status` and `evidence_read`. Record p95 `gpuMs` and p95 `cpuMs` of each run and the difference of the medians. If `gpuMs` is null, record it as unknown, find the render that taints the frame, and fix it before a new run. Gate: at most 2 ms `gpuMs` and at most 0.5 ms `cpuMs`.

- [ ] **Step 8: If the gate fails,** lower `SNOW_FLAKES` first (8,000, then 4,000), then `SNOW_SKY_SIZE` (256), and measure again. Record each try. If the gate still fails, or if the compute path does not run in the Editor window or in OBS, stop: write the result in `docs/evaluation/snow.md`, and ask the owner to select again. Do not start slice 2.

- [ ] **Step 9: Write the documents.** `docs/evaluation/snow.md`: the host, OS, build type, backend, OBS version, commit, each screenshot, each run, the first-frame time, and the limits seen. Spec: set the tier table and the constants to the measured values and the status line to "slice 1 verified" or "slice 1 failed". `docs/warudo-parity.md` ENV-10: one partial note that claims only what Steps 3 to 7 showed (MToon characters, WebGPU, control through MCP only).

- [ ] **Step 10: Clean and commit.** Remove the test entities from the scene and do not save a show. Run `direnv exec . cargo sweep --time 7`.

```bash
git add docs/evaluation/snow.md docs/superpowers/specs/2026-11-26-snow-design.md docs/warudo-parity.md packages/renderer
git commit -m "Record the snow feasibility evidence"
```
