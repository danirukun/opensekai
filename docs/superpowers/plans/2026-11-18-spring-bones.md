# Spring Bones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VRM spring bones (hair, cloth, accessories) move in the editor and in the OBS output, with the same motion at any renderer frame rate.

**Architecture:** Each renderer runs the stock three-vrm spring solver on a fixed 1/60 s grid in session time (the frame `tick`). It interpolates the posed skeleton between received frames. The session owns the inputs: the pose, the time, and a new per-avatar reset count (`springResets`), which it increases when an avatar root teleports. No spring data goes on the wire.

**Tech Stack:** TypeScript, Zod 4, Vitest, three 0.187 (`three/webgpu`), @pixiv/three-vrm 3.5.5, Rust (`opensekai-contracts`, serde).

**Spec:** [docs/superpowers/specs/2026-11-18-spring-bones-design.md](../specs/2026-11-18-spring-bones-design.md). Read it before each task. Decisions O1 to O3 and calls C1 to C9 are fixed.

## Global Constraints

- Work only in this worktree: `/Users/danirukun/.paradev/worktrees/opensekai/implement-from-issues-spring-134e6245`. The owner's dev app runs from the main checkout; an edit there reloads it and loses the owner's scene.
- Run every pnpm, cargo, and Tauri command as `direnv exec . <command>`. Run `direnv allow` one time first. Do not use `git -C` or a compound `cd`. Check `pwd` before each Git command.
- Before the first `cargo test` here, run `direnv exec . cargo clean -p <package>` for each workspace package (`cargo metadata --no-deps --format-version 1`), because another worktree may have built the shared target.
- Do not attribute commits or the PR to an agent: no `Co-Authored-By` trailer, no "Generated with" line.
- Never call `vrm.update()`. Call `vrm.springBoneManager.update(1 / 60)` and `.reset()` only through the spring rig (Task 5).
- Do not patch three-vrm for this feature (C8). Do not add a dependency.
- Step length 1/60 s. More than 15 due steps (0.25 s) means a reset. Teleport limits: 0.1 m, 30°, scale ratio 1.25 (C4).
- `springResets` has at most 2 entries (the scene allows 2 avatars), unique `avatarId`, and integer `count` ≥ 1.
- Functional TypeScript; match the dense one-line style of the file you edit. Add a comment only when the logic is hard to follow without it.
- Write docs, SPDD files, and the PR text in ASD-STE100. No new UI and no UI copy.

## Review Focus

1. **A model with no spring joints** (most props, some avatars): no error, no cost, and the pose is unchanged. Test in Task 6.
2. **A humanoid bone that a VRM 0.x bone group also lists as a spring joint:** the spring result stays, also on a frame with no due step (where `apply` has just reset the raw bone to rest). The pose restore must not overwrite it. Test in Task 6.
3. **The same frame applied twice** (a re-render at the same tick): no extra solver step. Test in Task 6.
4. **A new session** (new `sessionId`, tick back to 0 or a small forward jump): a reset, not a sweep from the old pose. Test in Task 4.
5. **An avatar whose model changes:** the session must not count it as a teleport, and the count must not go back. Test in Task 3.

---

### Task 1: Slice contract and architecture amendment

**Files:**
- Create: `spdd/analysis/2026-11-18-spring-bones.md`
- Create: `spdd/prompt/2026-11-18-spring-bones.md`
- Modify: `docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md:56` and `:74`
- Modify: `spdd/prompt/2026-10-03-minimum-live-vtubing.md:35`

**Interfaces:**
- Produces: the requirement IDs (R1, R2, …) that later commit messages and code comments cite, for example `// B43 R4: …`. Use bundle ID B43; if another branch takes B43 before merge, the integrator renumbers.

- [ ] **Step 1: Write the analysis.** Follow the sections of `spdd/analysis/2026-11-13-camera-effects.md` (Request, Sources, Current state, Decisions with Owner O1–O3 and Integrator C1–C9, Interpretations, Cost, Risks, Out of scope). Copy facts and numbers from the spec; do not add new claims.

- [ ] **Step 2: Write the REASONS contract.** Follow `spdd/prompt/2026-11-13-camera-effects.md`: a header with date, scope (B43, #14 CHR-08), analysis link, and the files it changes; then Decisions, Constants (the values in Global Constraints), R (Schema, Session, Renderer, Documents and evidence), E, A, S (the files of this plan), O (Tasks 2–7), N, S. One requirement for each rule in the spec sections "Inputs that the session owns", "Time grid", "Solver input", "Solver", "Scale", and "Warnings".

- [ ] **Step 3: Amend the three rules.** Replace the spring-bone sentences in the architecture design (lines 56 and 74) and in the minimum live VTubing contract (line 35, "Do not call VRM spring-bone simulation separately in each renderer.") with the new rule from the spec section "Architecture amendment". Keep the other sentences of each line. Add "(amended 2026-11-18, see the spring bones design)" after each changed sentence.

- [ ] **Step 4: Commit.**

```bash
pwd
git add spdd/analysis/2026-11-18-spring-bones.md spdd/prompt/2026-11-18-spring-bones.md docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md spdd/prompt/2026-10-03-minimum-live-vtubing.md
git commit -m "Add the spring bones slice contract and amend the secondary motion rule."
```

---

### Task 2: `springResets` frame field (TypeScript and Rust)

**Files:**
- Create: `fixtures/protocol/spring-resets.json`
- Modify: `packages/contracts/src/schema.ts:483-494` (`RuntimeFrameSchema`)
- Modify: `packages/contracts/src/types.ts:199-210` (`RuntimeFrame`)
- Modify: `crates/contracts/src/lib.rs` (`RuntimeFrame` at about line 1439, `impl Validate for RuntimeFrame` at about line 3000)
- Test: `packages/contracts/test/spring-resets.test.ts`, `crates/contracts/tests/spring_resets.rs`

**Interfaces:**
- Produces: TS `SpringResetSchema`, `interface SpringReset { avatarId: Id; count: number }`, `RuntimeFrame.springResets?: SpringReset[]`. Rust `SpringReset { avatar_id: Id, count: u64 }` (via the `object!` macro, as `ScreenPlayback` at line 563) and `RuntimeFrame.spring_resets: Option<Vec<SpringReset>>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`.

- [ ] **Step 1: Set up the worktree.** Run `direnv allow`, then `direnv exec . pnpm install`, then the `cargo clean -p` step from Global Constraints. Expected: install completes; no edit appears in the main checkout.

- [ ] **Step 2: Write the shared vectors** in `fixtures/protocol/spring-resets.json`:

```json
{
 "valid": [
  { "name": "one avatar", "springResets": [{ "avatarId": "performer", "count": 1 }] },
  { "name": "two avatars", "springResets": [{ "avatarId": "a", "count": 3 }, { "avatarId": "b", "count": 1 }] }
 ],
 "invalid": [
  { "name": "duplicate avatar", "springResets": [{ "avatarId": "a", "count": 1 }, { "avatarId": "a", "count": 2 }] },
  { "name": "zero count", "springResets": [{ "avatarId": "a", "count": 0 }] },
  { "name": "fraction", "springResets": [{ "avatarId": "a", "count": 1.5 }] },
  { "name": "negative", "springResets": [{ "avatarId": "a", "count": -1 }] },
  { "name": "three entries", "springResets": [{ "avatarId": "a", "count": 1 }, { "avatarId": "b", "count": 1 }, { "avatarId": "c", "count": 1 }] },
  { "name": "missing count", "springResets": [{ "avatarId": "a" }] },
  { "name": "extra field", "springResets": [{ "avatarId": "a", "count": 1, "tick": 4 }] }
 ]
}
```

- [ ] **Step 3: Write the failing tests.** Both read `fixtures/protocol/valid-frame.json`, set `springResets` from each vector, and check the result.

```ts
// packages/contracts/test/spring-resets.test.ts
import {expect,it} from 'vitest';
import vectors from '../../../fixtures/protocol/spring-resets.json';
import frame from '../../../fixtures/protocol/valid-frame.json';
import {RuntimeFrameSchema} from '../src/schema';
it('accepts the valid spring reset vectors',()=>{for(const v of vectors.valid)expect(RuntimeFrameSchema.safeParse({...frame,springResets:v.springResets}).success,v.name).toBe(true);});
it('rejects the invalid spring reset vectors',()=>{for(const v of vectors.invalid)expect(RuntimeFrameSchema.safeParse({...frame,springResets:v.springResets}).success,v.name).toBe(false);});
```

```rust
// crates/contracts/tests/spring_resets.rs
use opensekai_contracts::{RuntimeFrame, Validate};
use serde_json::Value;
fn json(text: &str) -> Value { serde_json::from_str(text).unwrap() }
fn frame(resets: &Value) -> Value {
    let mut frame = json(include_str!("../../../fixtures/protocol/valid-frame.json"));
    frame["springResets"] = resets.clone();
    frame
}
// B43 R1: the same vectors as packages/contracts/test/spring-resets.test.ts.
#[test]
fn spring_resets_match_the_shared_vectors() {
    let vectors = json(include_str!("../../../fixtures/protocol/spring-resets.json"));
    for vector in vectors["valid"].as_array().unwrap() {
        let value = frame(&vector["springResets"]);
        let parsed: RuntimeFrame = serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("{}: {e}", vector["name"]));
        assert!(parsed.validate().is_ok(), "{}", vector["name"]);
        assert_eq!(serde_json::to_value(&parsed).unwrap()["springResets"], value["springResets"]);
    }
    for vector in vectors["invalid"].as_array().unwrap() {
        let ok = serde_json::from_value::<RuntimeFrame>(frame(&vector["springResets"])).is_ok_and(|parsed| parsed.validate().is_ok());
        assert!(!ok, "{} passed", vector["name"]);
    }
}
```

- [ ] **Step 4: Run the tests and see them fail.**

Run: `direnv exec . pnpm vitest run --project unit packages/contracts/test/spring-resets.test.ts` and `direnv exec . cargo test -p opensekai-contracts --test spring_resets`
Expected: the valid vectors fail (unknown key `springResets` / `unknown field`).

- [ ] **Step 5: Implement.** TS: `export const SpringResetSchema = z.strictObject({ avatarId: IdSchema, count: u.min(1) });` and `springResets: z.array(SpringResetSchema).max(2).refine(values=>new Set(values.map(value=>value.avatarId)).size===values.length).optional()` in `RuntimeFrameSchema`. Rust: the struct, the field, and a check in `validate` with the message `"invalid spring resets"`: length ≤ 2, unique `avatar_id`, `1 <= count` and `count as f64 <= MAX_SAFE_INTEGER`.

- [ ] **Step 6: Run the tests and see them pass.** Same commands. Expected: PASS. Then `direnv exec . pnpm check` and `direnv exec . cargo test -p opensekai-contracts`. Expected: no errors.

- [ ] **Step 7: Commit.**

```bash
pwd
git add fixtures/protocol/spring-resets.json packages/contracts crates/contracts
git commit -m "Add the springResets frame field to the TypeScript and Rust contracts."
```

---

### Task 3: Session teleport rule

**Files:**
- Create: `packages/session/src/spring-resets.ts`
- Modify: `packages/session/src/session.ts` (state in the `createSession` closure; frame build at lines 549–557)
- Modify: `ARCHITECTURE.md:59` (Tracking path, step 3 "Compose")
- Test: `packages/session/test/spring-resets.test.ts`

**Interfaces:**
- Consumes: `SpringReset`, `SceneView`, `AvatarPose` from `@opensekai/contracts` (Task 2); `multiplyQuat` from `./bone-offsets`; `rotateByQuaternion` from `@opensekai/contracts`.
- Produces:
  - `export const TELEPORT_LIMITS = { metres: 0.1, degrees: 30, scaleRatio: 1.25 } as const`
  - `export type RootSample = { position: Vec3; rotation: Quat; scale: number }`
  - `export function avatarRoot(transform: { position: Vec3; rotation: Quat; scale: Vec3 }, root?: AvatarPose['root']): RootSample` — position `T + R·(S ⊙ p)`, rotation `R·q`, scale the mean of `|S|`.
  - `export function isTeleport(previous: RootSample, current: RootSample): boolean` — strictly more than a limit.
  - `export type SpringResetState = ReadonlyMap<string, { assetId: string | null; root: RootSample; count: number }>`
  - `export function advanceSpringResets(state: SpringResetState, scene: SceneView, poses: readonly AvatarPose[]): { state: SpringResetState; resets: SpringReset[] }` — for each avatar entity: the count goes up by 1 only when a previous value exists, its `assetId` is the same, and `isTeleport` is true. A changed asset keeps the old count. A removed entity leaves the state. `resets` lists the entries with `count > 0`, in scene order.

- [ ] **Step 1: Write the failing tests.**

```ts
import {expect,it} from 'vitest';
import {makeSmokeScene} from '@opensekai/contracts';
import {avatarRoot,isTeleport,advanceSpringResets} from '../src/spring-resets';
import {createSession} from '../src/session';
const at=(x:number,yawDeg=0,scale=1)=>({position:[x,0,0],rotation:[0,Math.sin(yawDeg*Math.PI/360),0,Math.cos(yawDeg*Math.PI/360)],scale} as const);
it('finds a teleport only above each limit',()=>{
 expect(isTeleport(at(0),at(.099))).toBe(false);expect(isTeleport(at(0),at(.101))).toBe(true);
 expect(isTeleport(at(0),at(0,29))).toBe(false);expect(isTeleport(at(0),at(0,31))).toBe(true);
 expect(isTeleport(at(0,0,1),at(0,0,1.24))).toBe(false);expect(isTeleport(at(0,0,1.25),at(0,0,.99))).toBe(true);
});
it('puts the pose root in the entity frame',()=>{
 const root=avatarRoot({position:[1,0,0],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,2,2]},{position:[1,0,0],rotation:[0,0,0,1]});
 expect(root.position[0]).toBeCloseTo(1);expect(root.position[2]).toBeCloseTo(-2);expect(root.scale).toBe(2);
});
it('counts a teleport of the performer and keeps the count on later frames',()=>{
 const s=createSession(makeSmokeScene(),'springs');
 expect(s.advance(0).springResets).toBeUndefined();
 const t=s.inspect().entities.find(e=>e.id==='performer')!.transform;
 expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setTransform',entityId:'performer',transform:{...t,position:[t.position[0]+1,t.position[1],t.position[2]]}}]} as never).ok).toBe(true);
 expect(s.advance(17).springResets).toEqual([{avatarId:'performer',count:1}]);
 expect(s.advance(34).springResets).toEqual([{avatarId:'performer',count:1}]);
});
const scene=(x:number,assetId='fixture_vrm_1',second?:number)=>{const s=makeSmokeScene();const p=s.entities.find(e=>e.id==='performer')!;Object.assign(p,{assetId,transform:{...p.transform,position:[x,0,0]}});
 if(second!==undefined)s.entities.push({...structuredClone(p),id:'guest',transform:{...p.transform,position:[second,0,0]}});return s;};
it('does not count a model change or a new avatar as a teleport, and keeps the count',()=>{
 let r=advanceSpringResets(new Map(),scene(0),[]);expect(r.resets).toEqual([]);
 r=advanceSpringResets(r.state,scene(1),[]);expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
 r=advanceSpringResets(r.state,scene(3,'avatar_b'),[]);expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
 r=advanceSpringResets(r.state,scene(3,'avatar_b',5),[]);expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
 expect(r.state.has('guest')).toBe(true);
 r=advanceSpringResets(r.state,scene(3,'avatar_b'),[]);expect(r.state.has('guest')).toBe(false);
});
```

- [ ] **Step 2: Run the tests and see them fail.** Run: `direnv exec . pnpm vitest run --project unit packages/session/test/spring-resets.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `spring-resets.ts`** with the interfaces above. Rotation angle: `2 * acos(min(1, |dot(q1, q2)|))`. Scale ratio: `max(a / b, b / a)`.

- [ ] **Step 4: Wire it into the session.** In `createSession`, keep `let springResets: SpringResetState = new Map();`. In `advance`, after `avatarPoses` is computed: `const springs = advanceSpringResets(springResets, scene, avatarPoses); springResets = springs.state;` and add `...(springs.resets.length ? { springResets: springs.resets } : {})` to the returned frame.

- [ ] **Step 5: Run the tests and see them pass.** Same command, then `direnv exec . pnpm vitest run --project unit packages/session` and `direnv exec . pnpm check`. Expected: PASS, no type errors.

- [ ] **Step 6: Update `ARCHITECTURE.md`** Tracking path step 3: one sentence that the session counts teleports of each avatar root (`spring-resets.ts`: more than 0.1 m, 30°, or a scale ratio of 1.25 in one tick) and sends the counts as `springResets` on the frame.

- [ ] **Step 7: Commit.**

```bash
pwd
git add packages/session ARCHITECTURE.md
git commit -m "Count avatar teleports in the session and send them as springResets."
```

---

### Task 4: Renderer step plan and pose record (pure)

**Files:**
- Create: `packages/renderer/src/spring-grid.ts`, `packages/renderer/src/spring-pose.ts`
- Test: `packages/renderer/test/spring-grid.test.ts`, `packages/renderer/test/spring-pose.test.ts`

**Interfaces:**
- Produces (`spring-grid.ts`):
  - `export const SPRING_STEP_SECONDS = 1 / 60; export const SPRING_MAX_STEPS = 15;`
  - `export type SpringClock = { sessionId: string; tick: number; elapsedMs: number; resets: number }`
  - `export type SpringPlan = { reset: boolean; fractions: number[] }`
  - `export function planSpringSteps(previous: SpringClock | null, current: SpringClock): SpringPlan`
- Produces (`spring-pose.ts`):
  - `export type PoseSample = Float64Array` (10 numbers for each node: position xyz, quaternion xyzw, scale xyz)
  - `export function capturePose(nodes: readonly Object3D[]): PoseSample`
  - `export function applyPose(nodes: readonly Object3D[], from: PoseSample, to: PoseSample, fraction: number): void` — lerp position and scale, slerp rotation (`Quaternion.slerpFlat`); at fraction 1 the values equal `to` exactly. It does not update matrices.

`planSpringSteps` rules, in this order:

```
previous null, other sessionId, or current.tick < previous.tick → { reset: true, fractions: [] }
n = current.tick − previous.tick; n > SPRING_MAX_STEPS        → { reset: true, fractions: [] }
current.resets ≠ previous.resets                              → { reset: true, fractions: n × [1] }
otherwise, for k = previous.tick + 1 … current.tick: span = current.elapsedMs − previous.elapsedMs;
  fraction = span > 0 ? clamp((k × 1000 / 60 − previous.elapsedMs) / span, 0, 1) : 1
```

- [ ] **Step 1: Write the failing tests.**

```ts
// spring-grid.test.ts
import {expect,it} from 'vitest';
import {planSpringSteps} from '../src/spring-grid';
const clock=(tick:number,elapsedMs:number,resets=0,sessionId='s')=>({sessionId,tick,elapsedMs,resets});
it('resets on the first frame, a new session, a step back in time, and a gap over 15 steps',()=>{
 expect(planSpringSteps(null,clock(3,50))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(3,50),clock(4,70,0,'t'))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(30,500),clock(2,40))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(0,0),clock(16,267))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(0,0),clock(15,250)).fractions).toHaveLength(15);
});
it('runs one step for each grid point after the previous tick, with fractions in frame time',()=>{
 const plan=planSpringSteps(clock(1,20),clock(3,52)); // grid points 33.3 ms and 50 ms
 expect(plan.reset).toBe(false);expect(plan.fractions[0]).toBeCloseTo((1000/30-20)/32,12);expect(plan.fractions[1]).toBeCloseTo(30/32,12);
});
it('runs no step for the same tick, and full-weight steps after a reset count change',()=>{
 expect(planSpringSteps(clock(3,50),clock(3,52))).toEqual({reset:false,fractions:[]});
 expect(planSpringSteps(clock(3,50),clock(3,52,1))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(3,50),clock(5,84,1))).toEqual({reset:true,fractions:[1,1]});
});
```

```ts
// spring-pose.test.ts
it('captures and blends position, rotation, and scale of each node',()=>{
 const a=new Object3D(),b=new Object3D();const from=capturePose([a,b]);
 a.position.set(2,0,0);a.quaternion.setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);a.scale.setScalar(3);b.position.set(0,4,0);
 const to=capturePose([a,b]);applyPose([a,b],from,to,.5);
 expect(a.position.toArray()).toEqual([1,0,0]);expect(a.scale.toArray()).toEqual([2,2,2]);expect(b.position.toArray()).toEqual([0,2,0]);
 expect(a.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4))).toBeLessThan(1e-9);
 applyPose([a,b],from,to,1);expect(a.position.toArray()).toEqual([2,0,0]);expect(a.scale.toArray()).toEqual([3,3,3]);
});
```

- [ ] **Step 2: Run the tests and see them fail.** Run: `direnv exec . pnpm vitest run --project unit packages/renderer/test/spring-grid.test.ts packages/renderer/test/spring-pose.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both files** with the interfaces and rules above. Import from `three/webgpu`, as `avatar-pose.ts` does.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pwd
git add packages/renderer/src/spring-grid.ts packages/renderer/src/spring-pose.ts packages/renderer/test/spring-grid.test.ts packages/renderer/test/spring-pose.test.ts
git commit -m "Add the spring step plan and the pose record for renderers."
```

---

### Task 5: Spring rig with scale

**Files:**
- Create: `packages/renderer/src/spring-rig.ts`
- Create: `packages/renderer/test/spring-fixture.ts` (test helper, not a test file)
- Test: `packages/renderer/test/spring-rig.test.ts`

**Interfaces:**
- Produces (`spring-rig.ts`):
  - `export type SpringRig = { joints: ReadonlySet<Object3D>; reset(): void; step(seconds: number): void; setScale(scale: number): void }`
  - `export function createSpringRig(vrm: VRM): SpringRig | null` — null when `vrm.springBoneManager` is missing or has no joints. It calls `springBoneManager.setInitState()` one time; call it while the skeleton is at rest. It keeps the file values: `hitRadius`, `stiffness`, `gravityPower` of each joint, and `radius` of each collider shape that has a numeric `radius` (sphere, capsule; a plane has none). `setScale(s)` does nothing when `s` equals the last value; otherwise it sets each value to the file value × `s`. `joints` is the set of joint bones. `step` calls `springBoneManager.update(seconds)`; `reset` calls `springBoneManager.reset()`.
- Produces (`spring-fixture.ts`):
  - `export function springAvatar(options?: { springs?: boolean; humanoidJoint?: boolean }): { vrm: VRM; head: Object3D; hair: Object3D[]; hand: Object3D }` — the humanoid of the `fixture()` in `avatar-pose.test.ts` (same bone list; `head` and `hand` are the raw `head` and `leftHand` bones), plus a hair chain under the head: `hair[0]` at (0, 0.1, −0.12), `hair[1]` and `hair[2]` each at (0, −0.1, 0) under the one before. Joints `hair[0]→hair[1]`, `hair[1]→hair[2]`, `hair[2]→null`, settings `{ stiffness: 1, gravityPower: 0.5, gravityDir: (0, −1, 0), dragForce: 0.4, hitRadius: 0.02 }`, one collider group with a sphere collider (radius 0.08) on the head. With `springs: false`, the VRM has no `springBoneManager`. With `humanoidJoint`, the raw `leftHand` bone is at (0.3, 0, 0) and is also a joint (child null), same settings. `metaVersion: '1'`, no `setInitState` call (the rig does it).

- [ ] **Step 1: Write the failing tests.**

```ts
import {expect,it} from 'vitest';
import type {VRMSpringBoneColliderShapeSphere} from '@pixiv/three-vrm';
import {createSpringRig} from '../src/spring-rig';
import {springAvatar} from './spring-fixture';
it('returns null for a model without spring joints',()=>{
 expect(createSpringRig(springAvatar({springs:false}).vrm)).toBeNull();
 const {vrm}=springAvatar();const manager=vrm.springBoneManager!;for(const joint of [...manager.joints])manager.deleteJoint(joint);
 expect(createSpringRig(vrm)).toBeNull();
});
it('scales hit radius, stiffness, gravity, and collider radius from the file values',()=>{
 const {vrm}=springAvatar();const rig=createSpringRig(vrm)!;
 const joint=[...vrm.springBoneManager!.joints][0];const shape=vrm.springBoneManager!.colliders[0].shape as VRMSpringBoneColliderShapeSphere;
 rig.setScale(2);expect(joint.settings).toMatchObject({hitRadius:.04,stiffness:2,gravityPower:1,dragForce:.4});expect(shape.radius).toBeCloseTo(.16,12);
 rig.setScale(.5);expect(joint.settings).toMatchObject({hitRadius:.01,stiffness:.5,gravityPower:.25});expect(shape.radius).toBeCloseTo(.04,12);
 rig.setScale(1);expect(joint.settings).toMatchObject({hitRadius:.02,stiffness:1,gravityPower:.5});expect(shape.radius).toBeCloseTo(.08,12);
});
it('writes nothing when the scale does not change',()=>{
 const {vrm}=springAvatar();const rig=createSpringRig(vrm)!;const joint=[...vrm.springBoneManager!.joints][0];
 rig.setScale(2);joint.settings.stiffness=7;rig.setScale(2);expect(joint.settings.stiffness).toBe(7);
});
it('lists the joint bones',()=>{const {vrm,hair}=springAvatar();expect([...createSpringRig(vrm)!.joints]).toEqual(hair);});
```

- [ ] **Step 2: Run the tests and see them fail.** Run: `direnv exec . pnpm vitest run --project unit packages/renderer/test/spring-rig.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `spring-rig.ts` and `spring-fixture.ts`.** The three-vrm loader already calls `setInitState()` at the end of an import, so the rig call is a second capture. This is safe: only `VRMUtils.rotateVRM0` (on the scene root) runs between the load and `createAvatarBinding`, and the first `advance` resets the tails.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
pwd
git add packages/renderer/src/spring-rig.ts packages/renderer/test/spring-fixture.ts packages/renderer/test/spring-rig.test.ts
git commit -m "Add the spring rig, which scales the joint and collider values with the avatar."
```

---

### Task 6: Spring stage in the avatar binding and the renderer

**Files:**
- Create: `packages/renderer/src/spring-stage.ts`
- Modify: `packages/renderer/src/avatar-pose.ts:17-124` (`createAvatarBinding`)
- Modify: `packages/renderer/src/renderer.ts:388` and `:406` (after `place` in the frame path and the install path)
- Modify: `packages/renderer/src/assets.ts:148-151` (warnings)
- Modify: `packages/renderer/test/avatar-pose.test.ts:35` (rename the `vrm.update` test)
- Modify: `ARCHITECTURE.md:60` (Tracking path step 4 "Render") and `:116` (Asset path step 4 "Load")
- Test: `packages/renderer/test/spring-stage.test.ts`, `packages/renderer/test/spring-warnings.test.ts`

**Interfaces:**
- Consumes: `planSpringSteps`, `SpringClock`, `SPRING_STEP_SECONDS` (Task 4); `capturePose`, `applyPose` (Task 4); `createSpringRig`, `SpringRig` (Task 5); `springAvatar` (Task 5).
- Produces:
  - `export function createSpringStage(rig: SpringRig, root: Object3D, posed: readonly Object3D[], held: readonly Object3D[]): { advance(clock: SpringClock): void }`
  - `createAvatarBinding(vrm)` returns `{ root, uv, apply, advanceSprings(clock: SpringClock): void }`. `advanceSprings` does nothing for a model without spring joints. `posed` is `[root, motion, ...raw humanoid bones that are not in rig.joints]`. `held` is the raw humanoid bones that are in `rig.joints` (empty for most models). The stage sets `kept = capturePose(held)` when it is created, `lastClock = null`, and `previous = null`.
  - `export function extensionWarnings(extensions: readonly string[], id: string): AppError[]` in `assets.ts`.

`advance(clock)` order:

```
current = capturePose(posed)
plan = planSpringSteps(lastClock, clock)
if plan.reset: rig.reset(); previous = null         // a reset never interpolates across the jump
rig.setScale(mean of |root.scale.x|, |root.scale.y|, |root.scale.z|)
for fraction of plan.fractions:
  applyPose(posed, previous ?? current, current, fraction); root.updateMatrixWorld(true); rig.step(SPRING_STEP_SECONDS)
if plan.fractions.length: applyPose(posed, current, current, 1); root.updateMatrixWorld(true)
if plan.reset or plan.fractions.length: kept = capturePose(held)
else: applyPose(held, kept, kept, 1); root.updateMatrixWorld(true)   // apply() reset these bones to rest
previous = current; lastClock = clock
```

`rig.reset()` reads the current parent transforms, so `apply` and `place` must run before `advance`; both already update the world matrices. `springBoneManager.update` updates the collider matrices itself (checked on 2026-11-18, also for a collider on a non-ancestor bone).

- [ ] **Step 1: Write the failing tests** in `spring-stage.test.ts`. The helper `drive` does what `renderer.ts` does in one frame: `apply`, then the transform that `place` sets, then `advanceSprings`. The test sets the raw head bone directly after `apply`, so it needs no `AvatarPose`.

```ts
import {expect,it,vi} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {createAvatarBinding} from '../src/avatar-pose';
import {springAvatar} from './spring-fixture';
const Y=new Vector3(0,1,0);
const clock=(tick:number,resets=0)=>({sessionId:'s',tick,elapsedMs:tick*1000/60+1,resets});
const make=(options?:Parameters<typeof springAvatar>[0])=>{const a=springAvatar(options);return {...a,binding:createAvatarBinding(a.vrm)};};
const drive=({binding,head}:ReturnType<typeof make>,tick:number,scale=1,resets=0)=>{
 binding.apply();head.quaternion.setFromAxisAngle(Y,Math.sin(tick/20)*.6);
 binding.root.position.set(Math.sin(tick/30)*.3*scale,0,0);binding.root.scale.setScalar(scale);binding.root.updateMatrixWorld(true);
 binding.advanceSprings(clock(tick,resets));};
const mean=(a:ReturnType<typeof make>,b:ReturnType<typeof make>)=>a.hair.reduce((sum,bone,i)=>sum+bone.quaternion.angleTo(b.hair[i].quaternion),0)/a.hair.length;
it('gives the same spring pose in two instances for the same frames',()=>{
 const a=make(),b=make();for(let t=1;t<=300;t++){drive(a,t);drive(b,t);}
 a.hair.forEach((bone,i)=>expect(bone.quaternion.toArray()).toEqual(b.hair[i].quaternion.toArray()));
});
it('stays within 1 degree mean when an instance gets every second frame',()=>{
 const a=make(),b=make();
 for(let t=1;t<=600;t++){drive(a,t);if(t%2===0){drive(b,t);if(t>150)expect(mean(a,b)).toBeLessThan(Math.PI/180);}}
});
it('returns the joints to rest under the current parent when the reset count changes',()=>{
 const a=make();for(let t=1;t<=60;t++)drive(a,t);drive(a,60,1,1);
 for(const bone of a.hair)expect(bone.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9);
});
it('moves a scaled avatar as a scaled copy',()=>{
 const a=make(),b=make();for(let t=1;t<=300;t++){drive(a,t);drive(b,t,2);}
 a.hair.forEach((bone,i)=>expect(bone.quaternion.angleTo(b.hair[i].quaternion)).toBeLessThan(1e-4));
});
it('never calls vrm.update',()=>{const a=make();const update=vi.spyOn(a.vrm,'update');for(let t=1;t<=30;t++)drive(a,t);expect(update).not.toHaveBeenCalled();});
it('does nothing for a model without spring joints',()=>{
 const a=make({springs:false});a.binding.apply();const rest=a.head.quaternion.clone();
 a.binding.advanceSprings(clock(1));a.binding.advanceSprings(clock(2));expect(a.head.quaternion.toArray()).toEqual(rest.toArray());
});
it('keeps a humanoid bone that is a spring joint at its spring result, also on a frame with no step',()=>{
 const a=make({humanoidJoint:true});const rest=a.hand.quaternion.clone();for(let t=1;t<=30;t++)drive(a,t);
 const moved=a.hand.quaternion.clone();expect(moved.angleTo(rest)).toBeGreaterThan(1e-3);
 drive(a,30);expect(a.hand.quaternion.angleTo(moved)).toBeLessThan(1e-12);
});
it('runs no extra step when the same frame is applied twice',()=>{
 const a=make(),b=make();for(let t=1;t<=120;t++){drive(a,t);drive(b,t);drive(b,t);}
 a.hair.forEach((bone,i)=>expect(bone.quaternion.toArray()).toEqual(b.hair[i].quaternion.toArray()));
});
```


In `spring-warnings.test.ts`:

```ts
it('warns for node constraints and spring bone limits only',()=>{
 expect(extensionWarnings(['VRMC_vrm','VRMC_springBone','VRMC_node_constraint','VRMC_springBone_limit'],'avatar_a')).toEqual([
  {code:'UNSUPPORTED',message:'VRMC_node_constraint simulation is disabled in renderer',ids:['avatar_a']},
  {code:'UNSUPPORTED',message:'VRMC_springBone_limit is not supported; spring bones move without limits',ids:['avatar_a']}]);
});
```

- [ ] **Step 2: Run the tests and see them fail.** Run: `direnv exec . pnpm vitest run --project unit packages/renderer/test/spring-stage.test.ts packages/renderer/test/spring-warnings.test.ts`. Expected: FAIL (`createSpringStage`, `advanceSprings`, `extensionWarnings` not defined).

- [ ] **Step 3: Implement `spring-stage.ts`** with the order above.

- [ ] **Step 4: Add `advanceSprings` to `createAvatarBinding`.** Create the rig and the stage at the top of `createAvatarBinding`, before any `apply`, so `setInitState` sees the rest pose. Rename the test at `avatar-pose.test.ts:35` to `'apply never calls vrm.update'`; keep its body.

- [ ] **Step 5: Call it in the renderer.** After `place` at `renderer.ts:388` and `:406`, call `value.avatar?.advanceSprings({ sessionId: frame.sessionId, tick: frame.tick, elapsedMs: frame.elapsedMs, resets: frame.springResets?.find(entry => entry.avatarId === entity.id)?.count ?? 0 })` (use `installed` and `entityId` in the install path). The call runs also when `editor.frozen` skips `place`.

- [ ] **Step 6: Replace the warning loop** at `assets.ts:148-151` with `warnings.push(...extensionWarnings(extensions, id))`.

- [ ] **Step 7: Run the tests and see them pass.** Run the Step 2 command, then `direnv exec . pnpm vitest run --project unit packages/renderer` and `direnv exec . pnpm check`. Expected: PASS, no type errors.

- [ ] **Step 8: Update `ARCHITECTURE.md`.** Tracking path step 4: after `place`, the spring stage (`spring-stage.ts`, `spring-grid.ts`, `spring-rig.ts`) runs the due 1/60 s steps from the frame `tick` on the interpolated posed skeleton, resets on `springResets`, a new session, a step back, or more than 15 due steps, and scales the joint and collider values with the avatar. Asset path step 4: the loader warns for `VRMC_node_constraint` and `VRMC_springBone_limit`, not for `VRMC_springBone`.

- [ ] **Step 9: Commit.**

```bash
pwd
git add packages/renderer ARCHITECTURE.md
git commit -m "Run VRM spring bones in each renderer on the session tick grid."
```

---

### Task 7: Local acceptance, evidence, and parity

**Files:**
- Create: `docs/evaluation/spring-bones.md` and captures in `docs/evaluation/spring-bones/`
- Modify: `docs/warudo-parity.md:81` (CHR-08), `docs/vpoyo-gaps.md:9` and `:26`
- Modify: `spdd/prompt/2026-11-18-spring-bones.md` (evidence links; teleport limits if QA changed them)

Follow `docs/qa.md` and `docs/testing.md`. Record the commit, backend, quality profile, and fixture (asset ID) for each check. An unavailable measurement is "unknown", never zero. Do not start a stream; local recording and screenshots are permitted. Use isolated OpenSekai test sources in OBS and keep the other OBS settings.

- [ ] **Step 1: Start the app from this worktree.** The owner's dev app holds port 1420 (`pgrep -fl "tauri dev"`). Ask the owner before you stop it; otherwise use `direnv exec . pnpm build:mac` and open the built app. Start it from Terminal.app (a `.command` file) if camera tracking is needed. Run `caffeinate -d -u` during timing checks.

- [ ] **Step 2: Character check.** Add Catboy and the newest Roro import (`avatar_c116520b…`, 30 joints) with tracking or idle. Hair and accessories move with head and body motion. Record a short clip of the editor.

- [ ] **Step 3: OBS check.** Capture the OBS output at the 60 fps and the 30 fps output limit. The motion looks the same, and the alpha around the hair is correct. Then minimize the editor and check that the OBS hair still moves.

- [ ] **Step 4: Teleport and scale check.** With the Inspector: move the character by 0.3 m and by 2 m, turn it by 45°, change its scale from 1 to 1.5. No whip or flip in the editor or in OBS. Drag the gizmo fast and slow, and write down what the hair does. If a limit gives a visible problem, change `TELEPORT_LIMITS`, add the case to the Task 3 tests, and record the new value and the reason in the contract.

- [ ] **Step 5: Cost check.** `FrameApplied.cpuMs` for 1 and 2 avatars, with this branch and with a build of the parent of the Task 2 commit, under the benchmark contract. Keep app timing and OBS timing separate. A difference inside the noise is reported as such.

- [ ] **Step 6: Write the evidence and the parity row.** `docs/evaluation/spring-bones.md` lists each check with its result and files. CHR-08 becomes Partial: VRM-authored spring bones in the editor and OBS (with the evidence link); controls, collisions with other objects, `VRMC_springBone_limit`, and non-uniform scale Later. Update the two `vpoyo-gaps.md` lines.

- [ ] **Step 7: Full checks.** `direnv exec . pnpm check`, `direnv exec . pnpm test:unit`, `direnv exec . cargo test -p opensekai-contracts`. Expected: all pass. Then `direnv exec . cargo sweep --time 7`.

- [ ] **Step 8: Commit, push, and open the PR.**

```bash
pwd
git add docs spdd
git commit -m "Record the spring bones acceptance checks and update CHR-08."
git push -u origin implement-spring-bones-134e6245
```

Open the PR with `gh pr create` against `main`: ASD-STE100 summary, the evidence link, the known limits, and "No database migration" for the schema-release rule. No agent attribution.
