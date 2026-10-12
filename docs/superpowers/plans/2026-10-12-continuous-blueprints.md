# Continuous Blueprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blueprints can read and write asset properties at runtime, run every tick (On Update), and read held keys from any app, so a WASD graph moves a character while another app has focus.

**Architecture:** A typed property registry in `@opensekai/contracts` defines Position, Rotation, Scale, Visible, and Field of View. New Blueprint nodes write a session-owned override layer instead of the persistent scene; the session renders the scene with overrides applied and commits each override to the persistent scene 250 ms after its last write. A native listen-only macOS event tap reports the held state of the keys that enabled graphs watch, on the existing clock `InputUpdate`.

**Tech Stack:** TypeScript (zod 4, Vitest 5, Svelte 5, Rete), Rust (Tauri 2, tokio, serde), macOS CoreGraphics/CoreFoundation through raw FFI (no new crates), pnpm.

**Spec:** `spdd/prompt/2026-10-12-continuous-blueprints.md` (REASONS) and `spdd/analysis/2026-10-12-continuous-blueprints.md`.

## Global Constraints

- Use pnpm. Run commands from the repository root `/Users/danirukun/ghq/github.com/oshi-connect/opensekai` (or the worktree root). Do not use `git -C` or compound `cd … &&` commands for Git.
- Prefer functional TypeScript and plain data. Add a comment only when the logic is hard to follow without it.
- Use `@oshi-connect/ui` controls in Svelte. UI copy is limited to the labels and messages in the spec: node labels (Make Vector3, Break Vector3, Add Vector3, Scale Vector3, Get Asset Property, Set Asset Property, Move Entity, On Update, Is Key Held, Key Axis), field labels (Key, Negative, Positive, Entity, Property, Space, World, Local), property labels (Position, Rotation, Scale, Visible, Field of View), warnings `Input Monitoring is off` and `Held keys are unavailable on this platform`, and the action **Open Settings**.
- Write prose (docs, commit bodies, evidence) in ASD-STE100 Simplified Technical English.
- The key monitor must never consume, change, or inject an event. Do not report, log, or store keys outside the watched set.
- Do not change the scene revision while overrides are written; commit only under the 250 ms idle rule. Never store overrides in a show document.
- Do not change On Keystroke Pressed, its modifier rule, or the persistent Scene nodes (Set Visibility, Toggle Visibility, Switch Camera).
- Add no new dependency (Rust or npm). The macOS monitor uses raw FFI to CoreGraphics and CoreFoundation.
- Unit tests for new function behavior; integration tests only at real process/network boundaries, with the reason stated.
- Unit test command: `pnpm test:unit`. Type check: `pnpm check`. Rust: `cargo test -p opensekai-contracts` and `cargo test -p opensekai-desktop` (package name check: `grep '^name' apps/desktop/src-tauri/Cargo.toml`).

## Review Focus

1. **A key released while the tap is disabled or the monitor stops** — the character must stop; held keys clear on tap-disable, on stop, and when the watched set changes (Task 6 test `clears_held_keys_on_disable_and_when_unwatched`).
2. **An editor drag or MCP `scene_patch` on an entity that a graph is moving** — the explicit edit wins and the stale override is not committed over it afterwards (Task 5 test `an editor transform patch drops the override and nothing commits over it`).
3. **A session stall (worker paused, minimized window) then resume** — On Update must not move an entity more than 0.1 s worth of motion (Task 4 test `clamps deltaSeconds to 0.1 and gives 0 on the first update`).
4. **Changing Set Asset Property from Position (vector3) to Visible (boolean)** — wires that no longer type-check are removed in the document and on the canvas, and the graph still compiles (Task 4 test `setNodeSettings drops connections whose types no longer match`; Task 8 test `retypes a port and removes its wire`).
5. **A graph that writes an invalid value (scale 0, FOV 200) or exceeds 256 overrides** — the graph gets a runtime error and the scene stays valid (Task 2 tests `rejects invalid values` and `limits the layer to 256 overrides`).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/contracts/src/property-registry.ts` (new) | Property registry, value validation, read/write on entities, Euler/quaternion math |
| `packages/contracts/src/blueprint-nodes/define.ts` | `vector3` port type, `Input` category, `key`/`property`/`space` field kinds |
| `packages/contracts/src/blueprint-nodes/vector3.ts` (new) | Vector3 node definitions |
| `packages/contracts/src/blueprint-nodes/input.ts` (new) | Is Key Held, Key Axis definitions; `heldKeyCodes` |
| `packages/contracts/src/blueprint-nodes/properties.ts` (new) | Get/Set Asset Property, Move Entity definitions |
| `packages/contracts/src/blueprint-nodes/events.ts`, `index.ts` | On Update; catalog order |
| `packages/contracts/src/blueprint-ops.ts` | `setNodeSettings` drops retyped connections |
| `packages/contracts/src/schema.ts`; `crates/contracts/src/lib.rs` | `InputUpdate.held`, `heldKeys` in Blueprint results |
| `packages/session/src/overrides.ts` (new) | Override layer: write, apply, take idle, drop |
| `packages/session/src/blueprint-eval/{types,vector3,input,properties,events,index}.ts` | `RunEnv`, evaluators |
| `packages/session/src/blueprint.ts`, `blueprint-runtime.ts`, `blueprint-store.ts`, `session.ts` | env plumbing, update events, held keys, override integration |
| `apps/desktop/src-tauri/src/input.rs`, `input/monitor.rs` (new) | `KeyMonitor` trait, `HeldKeys`, macOS tap, stub |
| `apps/desktop/src-tauri/src/service/{mod,router}.rs`, `bootstrap.rs`, `lib.rs`, `build.rs`, `capabilities/editor.json` | watched set, clock `held`, warning, Open Settings command |
| `apps/desktop/src/blueprints/{fields,rete-editor}.ts`, `components/BlueprintNodeFields.svelte`, `BlueprintPanel.svelte`, `app.css` | editor fields, retype, socket color, warning row |
| `apps/mcp/src/resources.ts` | registry in the node resource |

---

### Task 1: Property registry and rotation math

**Files:**
- Create: `packages/contracts/src/property-registry.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/property-registry.test.ts`

**Interfaces:**
- Consumes: `SceneEntity`, `Id`, `Reply` from `packages/contracts/src/types.ts`.
- Produces:
  - `type Vec3 = [number, number, number]`; `type PropertyType = 'number' | 'boolean' | 'vector3'`; `type PropertyValue = number | boolean | Vec3`
  - `PROPERTY_KEYS = ['position','rotation','scale','visible','fovDegrees'] as const`; `type PropertyKey`
  - `interface AssetProperty { key: PropertyKey; label: string; kinds: readonly SceneEntity['kind'][]; type: PropertyType; rule: PropertyRule }`
  - `PROPERTY_REGISTRY: readonly AssetProperty[]`, `assetProperty(key)`, `propertiesFor(kind)`, `blueprintPropertyCatalog()`
  - `propertyValueValid(key, value): boolean`, `readProperty(entity, key): PropertyValue | undefined`, `writeProperty(entity, key, value): Reply<SceneEntity>`
  - `quaternionFromEuler(e: Vec3): [number, number, number, number]`, `eulerFromQuaternion(q: readonly number[]): Vec3`, `rotateByQuaternion(v: Vec3, q: readonly number[]): Vec3`

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/test/property-registry.test.ts
import { expect, it } from 'vitest';
import { eulerFromQuaternion, makeSmokeScene, propertiesFor, quaternionFromEuler, readProperty, rotateByQuaternion, writeProperty, type SceneEntity } from '../src';

const entity = (id: string): SceneEntity => makeSmokeScene().entities.find(e => e.id === id)!;
const close = (actual: readonly number[], expected: readonly number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));

it('lists the properties of each entity kind', () => {
 expect(propertiesFor('camera').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible', 'fovDegrees']);
 expect(propertiesFor('avatar').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
 expect(propertiesFor('mesh').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
 expect(propertiesFor('tracking')).toEqual([]);
});

it('converts YXZ Euler degrees to a quaternion and back', () => {
 close(quaternionFromEuler([0, 90, 0]), [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
 close(eulerFromQuaternion(quaternionFromEuler([10, 45, -30])), [10, 45, -30]);
 close(eulerFromQuaternion(quaternionFromEuler([0, 270, 0])), [0, -90, 0]);
 expect(eulerFromQuaternion([0, 0, 0, 1])).toEqual([0, 0, 0]);
});

it('rotates a vector by a quaternion', () => {
 close(rotateByQuaternion([0, 0, 1], quaternionFromEuler([0, 90, 0])), [1, 0, 0]);
 close(rotateByQuaternion([1, 2, 3], [0, 0, 0, 1]), [1, 2, 3]);
});

it('reads and writes properties of an entity', () => {
 expect(readProperty(entity('reference'), 'position')).toEqual([0.9, 0.7, 0]);
 expect(readProperty(entity('camera_wide'), 'fovDegrees')).toBe(45);
 expect(readProperty(entity('performer'), 'fovDegrees')).toBeUndefined();
 const moved = writeProperty(entity('reference'), 'position', [1, 2, 3]);
 expect(moved.ok && moved.data.transform.position).toEqual([1, 2, 3]);
 const turned = writeProperty(entity('reference'), 'rotation', [0, 90, 0]);
 expect(turned.ok).toBe(true);
 if (turned.ok) close(turned.data.transform.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
 const zoom = writeProperty(entity('camera_wide'), 'fovDegrees', 30);
 expect(zoom.ok && zoom.data.kind === 'camera' && zoom.data.lens).toEqual({ fovDegrees: 30, near: 0.01, far: 100 });
});

it('rejects invalid values and properties that do not apply', () => {
 expect(writeProperty(entity('reference'), 'scale', [1, 0, 1])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid property value' } });
 expect(writeProperty(entity('camera_wide'), 'fovDegrees', 180).ok).toBe(false);
 expect(writeProperty(entity('reference'), 'position', [Number.NaN, 0, 0]).ok).toBe(false);
 expect(writeProperty(entity('reference'), 'visible', 1 as never).ok).toBe(false);
 expect(writeProperty(entity('performer'), 'fovDegrees', 30)).toMatchObject({ ok: false, error: { message: 'Property does not apply to this entity' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit packages/contracts/test/property-registry.test.ts`
Expected: FAIL — the imports `propertiesFor`, `quaternionFromEuler` and the others do not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/contracts/src/property-registry.ts
import type { Id, Reply, SceneEntity } from './types';

export type Vec3 = [number, number, number];
export type PropertyType = 'number' | 'boolean' | 'vector3';
export type PropertyValue = number | boolean | Vec3;
export type PropertyRule = { kind: 'finite' } | { kind: 'positive' } | { kind: 'range'; min: number; max: number } | { kind: 'boolean' };
export const PROPERTY_KEYS = ['position', 'rotation', 'scale', 'visible', 'fovDegrees'] as const;
export type PropertyKey = (typeof PROPERTY_KEYS)[number];
type Kind = SceneEntity['kind'];
export interface AssetProperty { key: PropertyKey; label: string; kinds: readonly Kind[]; type: PropertyType; rule: PropertyRule }

const placed: readonly Kind[] = ['mesh', 'avatar', 'camera'];
export const PROPERTY_REGISTRY: readonly AssetProperty[] = [
 { key: 'position', label: 'Position', kinds: placed, type: 'vector3', rule: { kind: 'finite' } },
 { key: 'rotation', label: 'Rotation', kinds: placed, type: 'vector3', rule: { kind: 'finite' } },
 { key: 'scale', label: 'Scale', kinds: placed, type: 'vector3', rule: { kind: 'positive' } },
 { key: 'visible', label: 'Visible', kinds: placed, type: 'boolean', rule: { kind: 'boolean' } },
 { key: 'fovDegrees', label: 'Field of View', kinds: ['camera'], type: 'number', rule: { kind: 'range', min: 1, max: 179 } },
];
export const assetProperty = (key: PropertyKey): AssetProperty => PROPERTY_REGISTRY.find(property => property.key === key)!;
export const propertiesFor = (kind: Kind): AssetProperty[] => PROPERTY_REGISTRY.filter(property => property.kinds.includes(kind));
export const blueprintPropertyCatalog = () => PROPERTY_REGISTRY.map(property => ({ ...property, kinds: [...property.kinds] }));

const RAD = Math.PI / 180;
const clean = (value: number) => (Object.is(value, -0) ? 0 : value);
// Euler degrees [x, y, z] in YXZ order, as three.js applies them.
export function quaternionFromEuler([x, y, z]: Vec3): [number, number, number, number] {
 const c1 = Math.cos(x * RAD / 2), c2 = Math.cos(y * RAD / 2), c3 = Math.cos(z * RAD / 2);
 const s1 = Math.sin(x * RAD / 2), s2 = Math.sin(y * RAD / 2), s3 = Math.sin(z * RAD / 2);
 return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
export function eulerFromQuaternion([qx = 0, qy = 0, qz = 0, qw = 1]: readonly number[]): Vec3 {
 const m11 = 1 - 2 * (qy * qy + qz * qz), m13 = 2 * (qx * qz + qy * qw);
 const m21 = 2 * (qx * qy + qz * qw), m22 = 1 - 2 * (qx * qx + qz * qz), m23 = 2 * (qy * qz - qx * qw);
 const m31 = 2 * (qx * qz - qy * qw), m33 = 1 - 2 * (qx * qx + qy * qy);
 const x = Math.asin(-Math.min(Math.max(m23, -1), 1));
 const [y, z] = Math.abs(m23) < 0.9999999 ? [Math.atan2(m13, m33), Math.atan2(m21, m22)] : [Math.atan2(-m31, m11), 0];
 return [clean(x / RAD), clean(y / RAD), clean(z / RAD)];
}
export function rotateByQuaternion([vx, vy, vz]: Vec3, [qx = 0, qy = 0, qz = 0, qw = 1]: readonly number[]): Vec3 {
 const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
 return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
export function propertyValueValid(key: PropertyKey, value: unknown): value is PropertyValue {
 const { type, rule } = assetProperty(key);
 if (type === 'boolean') return typeof value === 'boolean';
 if (type === 'vector3') return isVec3(value) && (rule.kind !== 'positive' || value.every(n => n > 0));
 return typeof value === 'number' && Number.isFinite(value) && (rule.kind !== 'range' || (value >= rule.min && value <= rule.max));
}
export function readProperty(entity: SceneEntity, key: PropertyKey): PropertyValue | undefined {
 if (!assetProperty(key).kinds.includes(entity.kind)) return undefined;
 switch (key) {
  case 'position': return [...entity.transform.position] as Vec3;
  case 'rotation': return eulerFromQuaternion(entity.transform.rotation);
  case 'scale': return [...entity.transform.scale] as Vec3;
  case 'visible': return entity.visible;
  case 'fovDegrees': return entity.kind === 'camera' ? entity.lens.fovDegrees : undefined;
 }
}
const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
export function writeProperty(entity: SceneEntity, key: PropertyKey, value: PropertyValue): Reply<SceneEntity> {
 if (!assetProperty(key).kinds.includes(entity.kind)) return fail('Property does not apply to this entity', [entity.id]);
 if (!propertyValueValid(key, value)) return fail('Invalid property value', [entity.id]);
 const next = structuredClone(entity);
 switch (key) {
  case 'position': next.transform.position = [...(value as Vec3)]; break;
  case 'rotation': next.transform.rotation = quaternionFromEuler(value as Vec3); break;
  case 'scale': next.transform.scale = [...(value as Vec3)]; break;
  case 'visible': next.visible = value as boolean; break;
  case 'fovDegrees': if (next.kind === 'camera') next.lens = { ...next.lens, fovDegrees: value as number }; break;
 }
 return { ok: true, data: next };
}
```

Add to `packages/contracts/src/index.ts`:

```ts
export * from './property-registry';
```

If `pnpm check` reports a type error on `next.transform` or `entity.transform` (the `tracking` member of the union), read `EntityBase` in `types.ts`: every entity has `transform`, so the error means a different shape — adapt the access, not the behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit packages/contracts/test/property-registry.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/property-registry.ts packages/contracts/src/index.ts packages/contracts/test/property-registry.test.ts
git commit -m "Add the asset property registry and rotation math"
```

---

### Task 2: Session override layer

**Files:**
- Create: `packages/session/src/overrides.ts`
- Test: `packages/session/test/overrides.test.ts`

**Interfaces:**
- Consumes (Task 1): `PropertyKey`, `PropertyValue`, `Vec3`, `writeProperty`, `rotateByQuaternion`.
- Produces:
  - `interface OverrideEntry { value: PropertyValue; lastWriteMs: number; graphIds: readonly Id[] }`
  - `type OverrideLayer = ReadonlyMap<Id, ReadonlyMap<PropertyKey, OverrideEntry>>`; `EMPTY_OVERRIDES`
  - `type OverrideWrite = { kind: 'setProperty'; entityId: Id; property: PropertyKey; value: PropertyValue } | { kind: 'moveEntity'; entityId: Id; space: 'world' | 'local'; delta: Vec3 }`
  - `MAX_OVERRIDES = 256`, `COMMIT_IDLE_MS = 250`
  - `overriddenEntity(scene, layer, entityId): SceneEntity | null`
  - `applyOverrides(scene: SceneView, layer): SceneView`
  - `writeOverride(layer, scene, write, graphId, nowMs): Reply<OverrideLayer>`
  - `takeIdle(scene, layer, nowMs): { operations: ScenePatch['operations']; graphIds: Id[]; remaining: OverrideLayer }`
  - `dropOverrides(layer, operations: ScenePatch['operations']): OverrideLayer`

- [ ] **Step 1: Write the failing test**

```ts
// packages/session/test/overrides.test.ts
import { expect, it } from 'vitest';
import { makeSmokeScene, quaternionFromEuler } from '@opensekai/contracts';
import { applyOverrides, dropOverrides, EMPTY_OVERRIDES, MAX_OVERRIDES, takeIdle, writeOverride, type OverrideLayer } from '../src/overrides';

const scene = makeSmokeScene();
const ok = <T>(reply: { ok: true; data: T } | { ok: false }): T => { if (!reply.ok) throw new Error('expected ok'); return reply.data; };
const set = (layer: OverrideLayer, entityId: string, property: 'position' | 'visible' | 'fovDegrees' | 'scale', value: never, at = 0, graph = 'g') =>
 writeOverride(layer, scene, { kind: 'setProperty', entityId, property, value }, graph, at);

it('applies overrides to the evaluated scene without changing the persistent one', () => {
 const layer = ok(set(EMPTY_OVERRIDES, 'reference', 'position', [1, 2, 3] as never));
 const evaluated = applyOverrides(scene, layer);
 expect(evaluated.entities.find(e => e.id === 'reference')?.transform.position).toEqual([1, 2, 3]);
 expect(scene.entities.find(e => e.id === 'reference')?.transform.position).toEqual([0.9, 0.7, 0]);
 expect(applyOverrides(scene, EMPTY_OVERRIDES)).toBe(scene);
});

it('moves from the current override, in world or local space', () => {
 let layer = ok(writeOverride(EMPTY_OVERRIDES, scene, { kind: 'moveEntity', entityId: 'reference', space: 'world', delta: [0, 0, 1] }, 'g', 0));
 layer = ok(writeOverride(layer, scene, { kind: 'moveEntity', entityId: 'reference', space: 'world', delta: [0, 0, 1] }, 'g', 16));
 expect(layer.get('reference')?.get('position')?.value).toEqual([0.9, 0.7, 2]);
 const turned = { ...scene, entities: scene.entities.map(e => e.id === 'reference' ? { ...e, transform: { ...e.transform, rotation: quaternionFromEuler([0, 90, 0]) } } : e) };
 const local = ok(writeOverride(EMPTY_OVERRIDES, turned, { kind: 'moveEntity', entityId: 'reference', space: 'local', delta: [0, 0, 1] }, 'g', 0));
 const [x, y, z] = local.get('reference')!.get('position')!.value as number[];
 expect(x).toBeCloseTo(1.9); expect(y).toBeCloseTo(0.7); expect(z).toBeCloseTo(0);
});

it('rejects invalid values and missing entities', () => {
 expect(set(EMPTY_OVERRIDES, 'reference', 'scale', [0, 1, 1] as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(set(EMPTY_OVERRIDES, 'camera_wide', 'fovDegrees', 200 as never).ok).toBe(false);
 expect(set(EMPTY_OVERRIDES, 'missing', 'visible', true as never)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('limits the layer to 256 overrides', () => {
 const many = new Map(Array.from({ length: MAX_OVERRIDES }, (_, i) => [`e${i}`, new Map([['visible' as const, { value: true, lastWriteMs: 0, graphIds: ['g'] }]])]));
 expect(set(many, 'reference', 'visible', false as never)).toMatchObject({ ok: false, error: { message: 'Override limit reached' } });
});

it('commits only overrides idle for 250 ms, in one batch of operations, and keeps the busy ones', () => {
 let layer = ok(set(EMPTY_OVERRIDES, 'reference', 'position', [1, 2, 3] as never, 0, 'a'));
 layer = ok(set(layer, 'camera_wide', 'fovDegrees', 30 as never, 0, 'b'));
 layer = ok(set(layer, 'marker', 'visible', false as never, 100, 'a'));
 expect(takeIdle(scene, layer, 249).operations).toEqual([]);
 const idle = takeIdle(scene, layer, 250);
 expect(idle.operations).toEqual([
  { kind: 'setTransform', entityId: 'reference', transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
  { kind: 'setCameraLens', entityId: 'camera_wide', lens: { fovDegrees: 30, near: 0.01, far: 100 } },
 ]);
 expect(idle.graphIds.sort()).toEqual(['a', 'b']);
 expect([...idle.remaining.keys()]).toEqual(['marker']);
});

it('drops overrides that an explicit edit changes', () => {
 let layer = ok(set(EMPTY_OVERRIDES, 'reference', 'position', [1, 2, 3] as never));
 layer = ok(set(layer, 'reference', 'visible', false as never));
 layer = ok(set(layer, 'marker', 'visible', false as never));
 const after = dropOverrides(layer, [{ kind: 'setTransform', entityId: 'reference', transform: scene.entities[2]!.transform }, { kind: 'removeEntity', entityId: 'marker' }]);
 expect([...after.get('reference')!.keys()]).toEqual(['visible']);
 expect(after.has('marker')).toBe(false);
 expect(dropOverrides(layer, [{ kind: 'renameEntity', entityId: 'reference', name: 'R' }])).toBe(layer);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --project unit packages/session/test/overrides.test.ts`
Expected: FAIL — `../src/overrides` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/session/src/overrides.ts
import { rotateByQuaternion, writeProperty, type Id, type PropertyKey, type PropertyValue, type Reply, type SceneEntity, type ScenePatch, type SceneView, type Vec3 } from '@opensekai/contracts';

export interface OverrideEntry { value: PropertyValue; lastWriteMs: number; graphIds: readonly Id[] }
export type OverrideLayer = ReadonlyMap<Id, ReadonlyMap<PropertyKey, OverrideEntry>>;
export type OverrideWrite =
 | { kind: 'setProperty'; entityId: Id; property: PropertyKey; value: PropertyValue }
 | { kind: 'moveEntity'; entityId: Id; space: 'world' | 'local'; delta: Vec3 };
type Operation = ScenePatch['operations'][number];
export const MAX_OVERRIDES = 256, COMMIT_IDLE_MS = 250;
export const EMPTY_OVERRIDES: OverrideLayer = new Map();

const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const size = (layer: OverrideLayer) => [...layer.values()].reduce((n, entries) => n + entries.size, 0);

export function overriddenEntity(scene: SceneView, layer: OverrideLayer, entityId: Id): SceneEntity | null {
 let entity = scene.entities.find(item => item.id === entityId);
 if (!entity) return null;
 for (const [key, entry] of layer.get(entityId) ?? []) {
  const next = writeProperty(entity, key, entry.value);
  if (next.ok) entity = next.data;
 }
 return entity;
}
export const applyOverrides = (scene: SceneView, layer: OverrideLayer): SceneView =>
 layer.size === 0 ? scene : { ...scene, entities: scene.entities.map(entity => (layer.has(entity.id) ? overriddenEntity(scene, layer, entity.id)! : entity)) };

export function writeOverride(layer: OverrideLayer, scene: SceneView, write: OverrideWrite, graphId: Id, nowMs: number): Reply<OverrideLayer> {
 const entity = overriddenEntity(scene, layer, write.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [write.entityId] } };
 let property: PropertyKey, value: PropertyValue;
 if (write.kind === 'setProperty') ({ property, value } = write);
 else {
  if (entity.kind === 'tracking') return fail('Property does not apply to this entity', [entity.id]);
  const delta = write.space === 'local' ? rotateByQuaternion(write.delta, entity.transform.rotation) : write.delta;
  const [x, y, z] = entity.transform.position;
  property = 'position';
  value = [x + delta[0], y + delta[1], z + delta[2]];
 }
 const checked = writeProperty(entity, property, value);
 if (!checked.ok) return checked;
 const own = layer.get(write.entityId), previous = own?.get(property);
 if (!previous && size(layer) >= MAX_OVERRIDES) return fail('Override limit reached', [write.entityId]);
 const graphIds = previous?.graphIds.includes(graphId) ? previous.graphIds : [...(previous?.graphIds ?? []), graphId];
 const next = new Map(layer);
 next.set(write.entityId, new Map(own).set(property, { value: structuredClone(value), lastWriteMs: nowMs, graphIds }));
 return { ok: true, data: next };
}

export function takeIdle(scene: SceneView, layer: OverrideLayer, nowMs: number): { operations: Operation[]; graphIds: Id[]; remaining: OverrideLayer } {
 const operations: Operation[] = [], graphIds = new Set<Id>(), remaining = new Map<Id, ReadonlyMap<PropertyKey, OverrideEntry>>();
 for (const [entityId, entries] of layer) {
  const idle = new Map([...entries].filter(([, entry]) => nowMs - entry.lastWriteMs >= COMMIT_IDLE_MS));
  const busy = new Map([...entries].filter(([key]) => !idle.has(key)));
  if (busy.size) remaining.set(entityId, busy);
  if (!idle.size) continue;
  for (const entry of idle.values()) for (const id of entry.graphIds) graphIds.add(id);
  const target = overriddenEntity(scene, new Map([[entityId, idle]]), entityId);
  if (!target) continue;
  if (idle.has('position') || idle.has('rotation') || idle.has('scale')) operations.push({ kind: 'setTransform', entityId, transform: structuredClone(target.transform) });
  if (idle.has('visible')) operations.push({ kind: 'setVisibility', entityId, visible: target.visible });
  if (idle.has('fovDegrees') && target.kind === 'camera') operations.push({ kind: 'setCameraLens', entityId, lens: structuredClone(target.lens) });
 }
 return { operations, graphIds: [...graphIds], remaining };
}

const touched = (operation: Operation): [Id, readonly PropertyKey[] | 'all'] | null => {
 switch (operation.kind) {
  case 'setTransform': return [operation.entityId, ['position', 'rotation', 'scale']];
  case 'setVisibility': return [operation.entityId, ['visible']];
  case 'setCameraLens': return [operation.entityId, ['fovDegrees']];
  case 'removeEntity': return [operation.entityId, 'all'];
  default: return null;
 }
};
export function dropOverrides(layer: OverrideLayer, operations: readonly Operation[]): OverrideLayer {
 let next: Map<Id, ReadonlyMap<PropertyKey, OverrideEntry>> | null = null;
 for (const operation of operations) {
  const hit = touched(operation);
  if (!hit || !(next ?? layer).has(hit[0])) continue;
  next ??= new Map(layer);
  const [id, keys] = hit;
  const kept = keys === 'all' ? new Map() : new Map([...next.get(id)!].filter(([key]) => !keys.includes(key)));
  if (kept.size) next.set(id, kept); else next.delete(id);
 }
 return next ?? layer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --project unit packages/session/test/overrides.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/overrides.ts packages/session/test/overrides.test.ts
git commit -m "Add the session override layer for runtime property writes"
```

---

### Task 3: Held keys in the clock and the Blueprint results (TypeScript and Rust)

**Files:**
- Modify: `packages/contracts/src/schema.ts:322-331` (`InputUpdateSchema`, `BlueprintInspectSchema`), `schema.ts` `ResultSchemas.blueprintEdit` (line ~372)
- Modify: `packages/session/src/session.ts:146` (`input?.events.map` → `input?.events?.map`)
- Modify: `crates/contracts/src/lib.rs:313` (`BlueprintEditResult`), `:320-345` (`InputUpdate`), `:1139` (result validation); `apps/desktop/src-tauri/src/input.rs` (`InputQueue::drain`)
- Test: `packages/contracts/test/held-keys.test.ts`, `crates/contracts/tests/held_keys.rs`

**Interfaces:**
- Produces (TS): `InputUpdate = { events?: KeystrokeEvent[]; held?: string[] }` (at least one present); `HeldCodeListSchema` (1–16 codes from `KEYSTROKE_CODES`); `blueprintEdit` result `{ revision, keystrokes, heldKeys? }`; `BlueprintInspect` `{ …, heldKeys? }`.
- Produces (Rust): `InputUpdate { events: Vec<InputEvent>, held: Vec<String> }` (both `#[serde(default, skip_serializing_if = "Vec::is_empty")]`); `BlueprintEditResult { revision, keystrokes, held_keys }` (`held_keys` default empty, skipped when empty).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/contracts/test/held-keys.test.ts
import { expect, it } from 'vitest';
import { BlueprintInspectSchema, InputUpdateSchema, ResultSchemas } from '../src';

it('accepts held keys alone, events alone, or both, but not an empty update', () => {
 expect(InputUpdateSchema.safeParse({ held: ['KeyW', 'KeyA'] }).success).toBe(true);
 expect(InputUpdateSchema.safeParse({ events: [{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }] }).success).toBe(true);
 expect(InputUpdateSchema.safeParse({ events: [{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }], held: ['KeyW'] }).success).toBe(true);
 expect(InputUpdateSchema.safeParse({}).success).toBe(false);
 expect(InputUpdateSchema.safeParse({ held: [] }).success).toBe(false);
 expect(InputUpdateSchema.safeParse({ held: ['ShiftLeft'] }).success).toBe(false);
 expect(InputUpdateSchema.safeParse({ held: Array(17).fill('KeyW') }).success).toBe(false);
});

it('carries the watched key set in Blueprint results only when it is not empty', () => {
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [] }).success).toBe(true);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], heldKeys: ['KeyW'] }).success).toBe(true);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], heldKeys: [] }).success).toBe(false);
 expect(BlueprintInspectSchema.safeParse({ kind: 'snapshot', revision: 1, blueprints: [], errors: [], keystrokes: [], heldKeys: ['KeyS'] }).success).toBe(true);
});
```

```rust
// crates/contracts/tests/held_keys.rs
use opensekai_contracts::*;
use serde_json::json;

#[test]
fn input_update_carries_held_keys_and_omits_empty_lists() {
    let held: InputUpdate = serde_json::from_value(json!({"held":["KeyW"]})).unwrap();
    assert!(held.validate().is_ok());
    assert_eq!(serde_json::to_value(&held).unwrap(), json!({"held":["KeyW"]}));
    let events: InputUpdate = serde_json::from_value(json!({"events":[{"kind":"keystroke","accelerator":"Control+Alt+KeyH"}]})).unwrap();
    assert!(events.validate().is_ok());
    assert_eq!(serde_json::to_value(&events).unwrap()["held"], serde_json::Value::Null);
    let empty: InputUpdate = serde_json::from_value(json!({})).unwrap();
    assert!(empty.validate().is_err());
    let many: InputUpdate = serde_json::from_value(json!({"held": vec!["KeyW"; 17]})).unwrap();
    assert!(many.validate().is_err());
}

#[test]
fn blueprint_edit_result_reads_held_keys_with_an_empty_default() {
    let old: BlueprintEditResult = serde_json::from_value(json!({"revision":1,"keystrokes":[]})).unwrap();
    assert!(old.held_keys.is_empty());
    let new: BlueprintEditResult = serde_json::from_value(json!({"revision":1,"keystrokes":[],"heldKeys":["KeyW"]})).unwrap();
    assert_eq!(new.held_keys, vec!["KeyW".to_string()]);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit packages/contracts/test/held-keys.test.ts`
Expected: FAIL — `held` is an unknown key and `events` is required.
Run: `cargo test -p opensekai-contracts --test held_keys`
Expected: FAIL to compile — no field `held` / `held_keys`.

- [ ] **Step 3: Implement (TypeScript)**

In `packages/contracts/src/schema.ts`, import the code list (`import { KEYSTROKE_CODES } from './blueprint-nodes';` — `schema.ts` already imports from the Blueprint modules; if this makes an import cycle at runtime, import `../../../fixtures/protocol/keystroke-codes.json` directly instead) and replace `InputUpdateSchema`:

```ts
export const HeldCodeListSchema = z.array(z.enum(KEYSTROKE_CODES as [string, ...string[]])).min(1).max(16);
export const InputUpdateSchema = z.strictObject({
    events: z.array(z.strictObject({ kind: z.literal('keystroke'), accelerator: z.string().min(1).max(64) })).min(1).max(16).optional(),
    held: HeldCodeListSchema.optional(),
}).refine(update => update.events !== undefined || update.held !== undefined, 'Input update is empty');
```

Add `heldKeys: HeldCodeListSchema.optional()` to both members of `BlueprintInspectSchema` and to `ResultSchemas.blueprintEdit` (`z.strictObject({ revision: u, keystrokes: KeystrokeListSchema, heldKeys: HeldCodeListSchema.optional() })`). `HeldCodeListSchema` must be declared before those schemas.

In `packages/session/src/session.ts` (`advance`), change `input?.events.map(` to `input?.events?.map(`. Run `pnpm check` and fix every other `.events.` access on an `InputUpdate` the same way.

- [ ] **Step 4: Implement (Rust)**

In `crates/contracts/src/lib.rs` replace `InputUpdate` and its `validate`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct InputUpdate {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<InputEvent>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held: Vec<String>,
}
impl InputUpdate {
    pub fn validate(&self) -> Result<(), AppError> {
        require(
            self.events.len() <= 16 && self.held.len() <= 16 && !(self.events.is_empty() && self.held.is_empty()),
            "invalid input event count",
        )?;
        for InputEvent::Keystroke { accelerator } in &self.events {
            require(!accelerator.is_empty() && accelerator.chars().count() <= 64, "invalid accelerator")?;
        }
        for code in &self.held {
            require(!code.is_empty() && code.chars().count() <= 32, "invalid held key")?;
        }
        Ok(())
    }
}
```

Replace `object!(BlueprintEditResult { revision: u64, keystrokes: Vec<String> });` with:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlueprintEditResult {
    pub revision: u64,
    pub keystrokes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held_keys: Vec<String>,
}
```

In the `blueprintEdit` result check near `lib.rs:1139`, add `require(r.held_keys.len() <= 16, "invalid held key count")?;` beside the existing keystroke check.

In `apps/desktop/src-tauri/src/input.rs` `InputQueue::drain`, construct `InputUpdate { events: …, held: vec![] }`. Run `cargo check --workspace` and add `held: vec![]` (or `..Default::default()`) at every other `InputUpdate { … }` literal.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit packages/contracts/test/held-keys.test.ts` → PASS, 2 tests.
Run: `cargo test -p opensekai-contracts` → all pass, including `held_keys`.
Run: `pnpm test:unit` → all pass (existing keystroke tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/schema.ts packages/contracts/test/held-keys.test.ts packages/session/src/session.ts crates/contracts/src/lib.rs crates/contracts/tests/held_keys.rs apps/desktop/src-tauri/src/input.rs
git commit -m "Carry held keys on the clock and the watched set in Blueprint results"
```

---

### Task 4: Vector3, On Update, and held-key nodes

**Files:**
- Modify: `packages/contracts/src/blueprint-nodes/define.ts`, `events.ts`, `index.ts`; Create: `vector3.ts`, `input.ts`
- Modify: `packages/contracts/src/blueprint-ops.ts` (`setNodeSettings`)
- Modify: `packages/session/src/blueprint-eval/types.ts`, `events.ts`, `index.ts`; Create: `blueprint-eval/vector3.ts`, `blueprint-eval/input.ts`
- Modify: `packages/session/src/blueprint.ts`, `blueprint-runtime.ts`, `blueprint-store.ts`, `session.ts`
- Test: `packages/contracts/test/blueprint-ops.test.ts` (append), `packages/session/test/continuous-nodes.test.ts`

**Interfaces:**
- Consumes (Task 1): `Vec3`. (Task 3): `InputUpdate.held`, `heldKeys` result field.
- Produces:
  - `PortType = 'flow' | 'number' | 'boolean' | 'vector3'`; `NodeCategory` adds `'Input'` (order: Events, Input, Flow, Values, Math, Logic, Variables, Scene)
  - `BlueprintField` adds `{ key; label; kind: 'key' }`, `{ key; label; kind: 'property' }`, `{ key; label; kind: 'space' }`
  - Node types `vector3.make|break|add|scale`, `event.update`, `input.keyHeld` (`{ code }`), `input.keyAxis` (`{ negative, positive }`)
  - `activeHeldKeys(graphs): string[]`; runtime `heldKeys(): string[]`
  - Session eval: `BlueprintValue = number | boolean | Vec3`; `interface RunEnv { deltaSeconds: number; held: ReadonlySet<string>; scene: SceneView | null }`; `NO_ENV`; `Evaluator.data(node, output, read, state, env)`; `FlowContext.env`
  - `BlueprintEvent` adds `{ kind: 'update' }`; `runtime.step(events, nowMs, gate?, env?: Omit<RunEnv, 'deltaSeconds'>)`
  - `runFlow(compiled, start, state, budget, nowMs, env = NO_ENV)`

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/test/blueprint-ops.test.ts`:

```ts
it('setNodeSettings drops connections whose types no longer match', () => {
 const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes: [
  { id: 'n', version: 1, type: 'value.number', settings: { value: 1 }, position: { x: 0, y: 0 } },
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: { x: 0, y: 0 } },
 ], connections: [{ id: 'c', sourceNodeId: 'n', sourcePort: 'value', targetNodeId: 'make', targetPort: 'x' }] };
 const kept = applyBlueprintOps([graph as never], [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'n', settings: { value: 2 } }]);
 expect(kept.ok && kept.data[0]!.connections).toHaveLength(1);
});
```

(This test pins the general rule with the nodes of this task; Task 5 adds the property case where a port changes type.)

```ts
// packages/session/test/continuous-nodes.test.ts
import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintGraph } from '@opensekai/contracts';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { createBlueprintRuntime, activeHeldKeys } from '../src/blueprint-runtime';
import { emptyState } from '../src/blueprint-eval';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[], id = 'g'): BlueprintGraph =>
 ({ schemaVersion: 1, id, name: id, enabled: true, variables: [{ id: 'v', name: 'V', type: 'number', default: 0 }], nodes, connections } as BlueprintGraph);
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const num = (id: string, value: number) => ({ id, version: 1, type: 'value.number', settings: { value }, position: at });

it('makes, adds, scales, and breaks Vector3 values', () => {
 const g = graph([
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
  num('one', 1), num('two', 2), num('three', 3),
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
  { id: 'add', version: 1, type: 'vector3.add', settings: {}, position: at },
  { id: 'scale', version: 1, type: 'vector3.scale', settings: {}, position: at },
  { id: 'break', version: 1, type: 'vector3.break', settings: {}, position: at },
  { id: 'set', version: 1, type: 'variable.setNumber', settings: { variableId: 'v' }, position: at },
 ], [
  wire('a', 'one', 'value', 'make', 'x'), wire('b', 'two', 'value', 'make', 'y'), wire('c', 'three', 'value', 'make', 'z'),
  wire('d', 'make', 'value', 'add', 'a'), wire('e', 'make', 'value', 'add', 'b'),
  wire('f', 'add', 'result', 'scale', 'value'), wire('g', 'two', 'value', 'scale', 'factor'),
  wire('h', 'scale', 'result', 'break', 'value'), wire('i', 'break', 'z', 'set', 'value'),
  wire('j', 'go', 'flow', 'set', 'flow'),
 ]);
 const compiled = compileBlueprint(g);
 if (!compiled.ok) throw new Error(compiled.error.message);
 const result = runFlow(compiled.data, { nodeId: 'go', port: 'flow' }, { ...emptyState(), variables: new Map([['v', 0]]) }, { visits: 64, effects: 8 }, 0);
 expect(result.ok && result.data.state.variables.get('v')).toBe(12);
});

it('rejects an unconnected vector3 input', () => {
 expect(compileBlueprint(graph([{ id: 'break', version: 1, type: 'vector3.break', settings: {}, position: at }], []))).toMatchObject({ ok: false, error: { message: 'Blueprint input is not connected' } });
});

// On Update → Set Visibility(reference, visible ← Is Key Held(KeyW)).
const held = graph([
 { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at },
 { id: 'key', version: 1, type: 'input.keyHeld', settings: { code: 'KeyW' }, position: at },
 { id: 'show', version: 1, type: 'scene.setVisibility', settings: { entityId: 'reference' }, position: at },
], [wire('a', 'tick', 'flow', 'show', 'flow'), wire('b', 'key', 'held', 'show', 'visible')]);

it('runs On Update on every advance and reads held keys from the clock', () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [held] }] });
 const visible = () => session.inspect().entities.find(e => e.id === 'reference')?.visible;
 session.advance(0);
 expect(visible()).toBe(false);
 session.advance(16, 16, { held: ['KeyW'] });
 expect(visible()).toBe(true);
 session.advance(32);
 expect(visible()).toBe(false);
});

it('reports the watched keys of enabled graphs', () => {
 const axis = graph([{ id: 'axis', version: 1, type: 'input.keyAxis', settings: { negative: 'KeyS', positive: 'KeyW' }, position: at }], [], 'axis');
 expect(activeHeldKeys([held, axis])).toEqual(['KeyS', 'KeyW']);
 expect(activeHeldKeys([{ ...held, enabled: false }])).toEqual([]);
 const session = createSession(makeSmokeScene(), 's');
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [held, axis] }] })).toEqual({ ok: true, data: { revision: 1, keystrokes: [], heldKeys: ['KeyS', 'KeyW'] } });
 expect(session.inspectBlueprints().heldKeys).toEqual(['KeyS', 'KeyW']);
});

it('clamps deltaSeconds to 0.1 and gives 0 on the first update', () => {
 // On Update → Set Visibility(reference, visible ← deltaSeconds > threshold).
 const over = (threshold: number, id: string) => graph([
  { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at }, num('limit', threshold),
  { id: 'gt', version: 1, type: 'logic.greater', settings: {}, position: at },
  { id: 'show', version: 1, type: 'scene.setVisibility', settings: { entityId: id }, position: at },
 ], [wire('a', 'tick', 'flow', 'show', 'flow'), wire('b', 'tick', 'deltaSeconds', 'gt', 'a'), wire('c', 'limit', 'value', 'gt', 'b'), wire('d', 'gt', 'result', 'show', 'visible')], id);
 const runtime = createBlueprintRuntime();
 runtime.install([over(0, 'marker'), over(0.0999, 'reference'), over(0.1, 'performer')]);
 const visible = (runs: ReturnType<typeof runtime.step>) => Object.fromEntries(runs.flatMap(run => run.effects).map(e => [(e as { entityId: string }).entityId, (e as { visible: boolean }).visible]));
 expect(visible(runtime.step([{ kind: 'update' }], 1000))).toEqual({ marker: false, reference: false, performer: false });
 expect(visible(runtime.step([{ kind: 'update' }], 1050))).toEqual({ marker: true, reference: false, performer: false });
 expect(visible(runtime.step([{ kind: 'update' }], 60_000))).toEqual({ marker: true, reference: true, performer: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit packages/session/test/continuous-nodes.test.ts packages/contracts/test/blueprint-ops.test.ts`
Expected: FAIL — unknown node types `vector3.make`, `event.update`, `input.keyHeld`; `activeHeldKeys` is not exported.

- [ ] **Step 3: Contracts — port type, categories, fields, node definitions**

`define.ts`:

```ts
export type PortType = 'flow' | 'number' | 'boolean' | 'vector3';
export type NodeCategory = 'Events' | 'Input' | 'Flow' | 'Values' | 'Math' | 'Logic' | 'Variables' | 'Scene';
export const NODE_CATEGORIES: readonly NodeCategory[] = ['Events', 'Input', 'Flow', 'Values', 'Math', 'Logic', 'Variables', 'Scene'];
```

and add to the `BlueprintField` union:

```ts
 | { key: string; label: string; kind: 'key' | 'property' | 'space' };
```

`events.ts` — append to `EVENT_NODES`:

```ts
 defineNode({ type: 'event.update', label: 'On Update', category: 'Events', keywords: ['tick', 'frame', 'every', 'continuous', 'loop'], settings: empty, ports: () => ({ inputs: {}, outputs: { flow: 'flow', deltaSeconds: 'number' } }), defaults: () => ({}), fields: [] }),
```

`vector3.ts` (new):

```ts
import { defineNode, empty, type PortShape } from './define';

const vector = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape) =>
 defineNode({ type, label, category: 'Math', keywords: ['vector', ...keywords], settings: empty, ports, defaults: () => ({}), fields: [] });
export const VECTOR3_NODES = [
 vector('vector3.make', 'Make Vector3', ['xyz', 'compose', 'position'], () => ({ inputs: { x: 'number', y: 'number', z: 'number' }, outputs: { value: 'vector3' } })),
 vector('vector3.break', 'Break Vector3', ['xyz', 'decompose', 'split'], () => ({ inputs: { value: 'vector3' }, outputs: { x: 'number', y: 'number', z: 'number' } })),
 vector('vector3.add', 'Add Vector3', ['plus', 'offset', 'sum'], () => ({ inputs: { a: 'vector3', b: 'vector3' }, outputs: { result: 'vector3' } })),
 vector('vector3.scale', 'Scale Vector3', ['multiply', 'times', 'speed'], () => ({ inputs: { value: 'vector3', factor: 'number' }, outputs: { result: 'vector3' } })),
] as const;
```

`input.ts` (new):

```ts
import { z } from 'zod';
import codes from '../../../../fixtures/protocol/keystroke-codes.json';
import { defineNode } from './define';

const Code = z.enum(codes as [string, ...string[]]);
export const INPUT_NODES = [
 defineNode({ type: 'input.keyHeld', label: 'Is Key Held', category: 'Input', keywords: ['key', 'down', 'hold', 'keyboard', 'pressed'], settings: z.strictObject({ code: Code }), ports: () => ({ inputs: {}, outputs: { held: 'boolean' } }), defaults: () => ({ code: 'KeyW' }), fields: [{ key: 'code', label: 'Key', kind: 'key' }] }),
 defineNode({ type: 'input.keyAxis', label: 'Key Axis', category: 'Input', keywords: ['wasd', 'arrows', 'move', 'axis', 'keyboard'], settings: z.strictObject({ negative: Code, positive: Code }), ports: () => ({ inputs: {}, outputs: { value: 'number' } }), defaults: () => ({ negative: 'KeyS', positive: 'KeyW' }), fields: [{ key: 'negative', label: 'Negative', kind: 'key' }, { key: 'positive', label: 'Positive', kind: 'key' }] }),
] as const;
```

`index.ts`: import `INPUT_NODES` and `VECTOR3_NODES` and set

```ts
export const NODE_DEFINITIONS = [...EVENT_NODES, ...INPUT_NODES, ...FLOW_NODES, ...VALUE_NODES, ...MATH_NODES, ...VECTOR3_NODES, ...LOGIC_NODES, ...VARIABLE_NODES, ...SCENE_NODES] as const;
```

`blueprint-ops.ts` `setNodeSettings` — replace the connection filter (it only checked that the port exists) with a type check of both ends:

```ts
    graph.nodes[i] = parsed.data;
    graph.connections = graph.connections.filter(c => {
     if (c.sourceNodeId !== op.nodeId && c.targetNodeId !== op.nodeId) return true;
     const source = graph.nodes.find(n => n.id === c.sourceNodeId), target = graph.nodes.find(n => n.id === c.targetNodeId);
     return !!source && !!target && connectionType(source, c.sourcePort, target, c.targetPort) !== null;
    });
```

(import `connectionType` from `./blueprint-nodes`; drop the now-unused `ownPort`/`blueprintPorts` imports if `pnpm check` reports them.)

- [ ] **Step 4: Session — env, evaluators, update events, held keys**

`blueprint-eval/types.ts`:

```ts
import type { BlueprintKind, BlueprintNodeOf, Id, SceneView, Vec3 } from '@opensekai/contracts';
export type BlueprintValue = number | boolean | Vec3;
// Per-run inputs from outside the graph.
export interface RunEnv { deltaSeconds: number; held: ReadonlySet<string>; scene: SceneView | null }
export const NO_ENV: RunEnv = { deltaSeconds: 0, held: new Set(), scene: null };
```

Add `env: RunEnv;` to `FlowContext`, and change `Evaluator.data` to `data?(node: N, output: string, read: Read, state: RunState, env: RunEnv): BlueprintValue;`.

`blueprint-eval/vector3.ts` (new):

```ts
import type { Vec3 } from '@opensekai/contracts';
import type { EvaluatorTable, Read } from './types';

const vec = (read: Read, port: string) => read(port) as Vec3;
export const VECTOR3_EVALUATORS = {
 'vector3.make': { data: (_n, _o, read) => [Number(read('x')), Number(read('y')), Number(read('z'))] as Vec3 },
 'vector3.break': { data: (_n, output, read) => vec(read, 'value')[output === 'x' ? 0 : output === 'y' ? 1 : 2]! },
 'vector3.add': { data: (_n, _o, read) => { const a = vec(read, 'a'), b = vec(read, 'b'); return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vec3; } },
 'vector3.scale': { data: (_n, _o, read) => { const v = vec(read, 'value'), f = Number(read('factor')); return [v[0] * f, v[1] * f, v[2] * f] as Vec3; } },
} satisfies Partial<EvaluatorTable>;
```

`blueprint-eval/input.ts` (new):

```ts
import type { EvaluatorTable } from './types';

export const INPUT_EVALUATORS = {
 'input.keyHeld': { data: (node, _o, _r, _s, env) => env.held.has(node.settings.code) },
 'input.keyAxis': { data: (node, _o, _r, _s, env) => Number(env.held.has(node.settings.positive)) - Number(env.held.has(node.settings.negative)) },
} satisfies Partial<EvaluatorTable>;
```

`blueprint-eval/events.ts`: add `'event.update': { data: (_n, _o, _r, _s, env) => env.deltaSeconds },`. `blueprint-eval/index.ts`: spread `INPUT_EVALUATORS` and `VECTOR3_EVALUATORS` into `EVALUATORS`; also `export { NO_ENV, type RunEnv }` comes through `export * from './types'`.

`blueprint.ts`:
- `readInput(compiled, state, nodeId, port, env: RunEnv)`; pass `env` as the 5th argument of `data(...)`; replace the finite check with
  ```ts
  if (Array.isArray(result) ? !result.every(Number.isFinite) : typeof result === 'number' && !Number.isFinite(result)) throw new RangeError('Blueprint number is not finite');
  ```
- `runFlow(compiled, start, state, budget, nowMs, env: RunEnv = NO_ENV)`; in the flow context add `env,` and use `read: port => readInput(compiled, next, node.id, port, env)`.

`blueprint-runtime.ts`:

```ts
export type BlueprintEvent = { kind: 'manual'; graphId: Id; nodeId: Id } | { kind: 'keystroke'; accelerator: string } | { kind: 'update' };
export const activeHeldKeys = (graphs: readonly BlueprintGraph[]): string[] => [...new Set(graphs.filter(graph => graph.enabled).flatMap(graph => graph.nodes.flatMap(node =>
 node.type === 'input.keyHeld' ? [node.settings.code] : node.type === 'input.keyAxis' ? [node.settings.negative, node.settings.positive] : [])))].sort();
```

- `BlueprintRuntime` gains `heldKeys(): string[]` (`heldKeys: () => activeHeldKeys(active.map(entry => entry.compiled.graph))`) and `step(events, nowMs, gate?, env?: Omit<RunEnv, 'deltaSeconds'>)`.
- `Active` gains `lastUpdateMs?: number` (a new entry starts without it, so the first update after enable gives 0).
- `run(entry, start, budget, nowMs, gate, env: RunEnv)` passes `env` to `runFlow`. Enable runs and delay runs use `{ ...base, deltaSeconds: 0 }` where `base = env ?? { held: new Set<string>(), scene: null }`.
- In `step`, handle update events before the keystroke match:

```ts
   for (const event of events) {
    if (event.kind === 'update') {
     for (const entry of active) {
      const graph = entry.compiled.graph;
      const starts = graph.enabled ? graph.nodes.filter(node => node.type === 'event.update') : [];
      if (starts.length === 0) continue;
      const deltaSeconds = entry.lastUpdateMs === undefined ? 0 : Math.min(Math.max((nowMs - entry.lastUpdateMs) / 1000, 0), 0.1);
      entry.lastUpdateMs = nowMs;
      for (const node of starts) runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate, { ...base, deltaSeconds }));
     }
     continue;
    }
    // … existing manual/keystroke matching, passing { ...base, deltaSeconds: 0 } to run
   }
```

`blueprint-store.ts`: add `const MAX_HELD_KEYS = 16;`; after the accelerator check add
`if (activeHeldKeys(nextActive.map(entry => entry.graph)).length > MAX_HELD_KEYS) return fail('Too many held keys');`
Return `{ revision, keystrokes: runtime.keystrokes(), ...heldKeysField(runtime.heldKeys()) }` from `edit`, and add `...heldKeysField(runtime.heldKeys())` to each snapshot/delta object in `inspect`, with
`const heldKeysField = (keys: string[]) => (keys.length ? { heldKeys: keys } : {});`
Update the `edit` return type to `Reply<{ revision: number; keystrokes: string[]; heldKeys?: string[] }>` and the matching `Session.editBlueprints` type in `session.ts`.

`session.ts` `advance`: build the events and env:

```ts
            const events: BlueprintEvent[] = [...(input?.events?.map(event => ({ kind: 'keystroke' as const, accelerator: event.accelerator })) ?? []), { kind: 'update' }];
            stepBlueprints(events, elapsedMs, { held: new Set(input?.held ?? []), scene: persistent });
```

and give `stepBlueprints` a third parameter `env: Omit<RunEnv, 'deltaSeconds'>` that it passes as the 4th argument of `runtime.step`. `runBlueprint` passes `{ held: new Set(), scene: persistent }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit packages/session/test/continuous-nodes.test.ts packages/contracts/test/blueprint-ops.test.ts`
Expected: PASS.
Run: `pnpm test:unit` and `pnpm check`
Expected: all pass, 0 type errors. If a catalog snapshot test (for example `blueprint-definitions.test.ts`) lists node types or categories, add the new entries to its expectation — this is an intended catalog change.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/session
git commit -m "Add Vector3 values, On Update, and held-key nodes"
```

---

### Task 5: Asset property nodes and the override integration

**Files:**
- Create: `packages/contracts/src/blueprint-nodes/properties.ts`; Modify: `blueprint-nodes/index.ts`
- Create: `packages/session/src/blueprint-eval/properties.ts`; Modify: `blueprint-eval/index.ts`, `packages/session/src/blueprint.ts` (`BlueprintEffect`), `session.ts`
- Test: `packages/session/test/property-nodes.test.ts`; append to `packages/contracts/test/blueprint-ops.test.ts`

**Interfaces:**
- Consumes: Task 1 registry, Task 2 `writeOverride`/`applyOverrides`/`takeIdle`/`dropOverrides`/`EMPTY_OVERRIDES`/`OverrideWrite`, Task 4 env.
- Produces:
  - Node types `property.get` (`{ entityId, property }`, output `value`), `property.set` (`{ entityId, property }`, inputs `flow`, `value`; output `exit`), `entity.move` (`{ entityId, space: 'world' | 'local' }`, inputs `flow`, `delta: vector3`; output `exit`); `dynamicPorts: true` on get/set
  - `BlueprintEffect` adds `OverrideWrite` members (`setProperty`, `moveEntity`); `isOverrideEffect(effect)`
  - Session: frames, tracking, and Get Asset Property read `applyOverrides(persistent, overrides)`; idle overrides commit each advance.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/test/blueprint-ops.test.ts`:

```ts
it('setNodeSettings drops a property value wire when the property type changes', () => {
 const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes: [
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: { x: 0, y: 0 } },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'e', property: 'position' }, position: { x: 0, y: 0 } },
 ], connections: [{ id: 'c', sourceNodeId: 'make', sourcePort: 'value', targetNodeId: 'set', targetPort: 'value' }] };
 const same = applyBlueprintOps([graph as never], [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'set', settings: { entityId: 'e', property: 'scale' } }]);
 expect(same.ok && same.data[0]!.connections).toHaveLength(1);
 const retyped = applyBlueprintOps([graph as never], [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'set', settings: { entityId: 'e', property: 'visible' } }]);
 expect(retyped.ok && retyped.data[0]!.connections).toEqual([]);
});
```

```ts
// packages/session/test/property-nodes.test.ts
import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintGraph } from '@opensekai/contracts';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const num = (id: string, value: number) => ({ id, version: 1, type: 'value.number', settings: { value }, position: at });
// On Update → Move Entity(reference, world, delta = Make Vector3(0, 0, Key Axis(S, W))).
const wasd: BlueprintGraph = { schemaVersion: 1, id: 'wasd', name: 'WASD', enabled: true, variables: [], nodes: [
 { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at },
 { id: 'axis', version: 1, type: 'input.keyAxis', settings: { negative: 'KeyS', positive: 'KeyW' }, position: at },
 num('zero', 0),
 { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
 { id: 'move', version: 1, type: 'entity.move', settings: { entityId: 'reference', space: 'world' }, position: at },
], connections: [
 wire('a', 'tick', 'flow', 'move', 'flow'), wire('b', 'zero', 'value', 'make', 'x'), wire('c', 'zero', 'value', 'make', 'y'),
 wire('d', 'axis', 'value', 'make', 'z'), wire('e', 'make', 'value', 'move', 'delta'),
] } as BlueprintGraph;
const W = { held: ['KeyW'] };
const start = () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [wasd] }] });
 return session;
};
const z = (scene: { entities: { id: string; transform: { position: number[] } }[] }) => scene.entities.find(e => e.id === 'reference')!.transform.position[2];

it('moves an entity while a key is held without changing the scene revision, then commits once', () => {
 const session = start();
 const before = session.inspect().revision;
 let frame = session.advance(0, 0, W);
 for (let t = 16; t <= 160; t += 16) frame = session.advance(t, t, W);
 expect(z(frame.scene)).toBe(11);
 expect(session.inspect().revision).toBe(before);
 expect(z(session.inspect())).toBe(0);
 session.advance(176);
 session.advance(409);
 expect(session.inspect().revision).toBe(before);
 session.advance(410);
 expect(z(session.inspect())).toBe(11);
 expect(session.inspect().revision).toBe(before + 1);
 session.advance(800);
 expect(session.inspect().revision).toBe(before + 1);
});

it('an editor transform patch drops the override and nothing commits over it', () => {
 const session = start();
 session.advance(0, 0, W); session.advance(16, 16, W);
 const scene = session.inspect();
 const transform = { position: [5, 0, 5] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };
 expect(session.applyPatch({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations: [{ kind: 'setTransform', entityId: 'reference', transform }] }).ok).toBe(true);
 const frame = session.advance(32);
 expect(frame.scene.entities.find(e => e.id === 'reference')!.transform.position).toEqual([5, 0, 5]);
 session.advance(600);
 expect(session.inspect().entities.find(e => e.id === 'reference')!.transform.position).toEqual([5, 0, 5]);
});

it('sets and gets asset properties and reports invalid writes as runtime errors', () => {
 const g = { schemaVersion: 1, id: 'fov', name: 'FOV', enabled: true, variables: [], nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'get', version: 1, type: 'property.get', settings: { entityId: 'camera_wide', property: 'fovDegrees' }, position: at },
  num('half', 0.5), { id: 'mul', version: 1, type: 'math.multiply', settings: {}, position: at },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'camera_wide', property: 'fovDegrees' }, position: at },
  { id: 'big', version: 1, type: 'event.manual', settings: {}, position: at }, num('huge', 500),
  { id: 'bad', version: 1, type: 'property.set', settings: { entityId: 'camera_wide', property: 'fovDegrees' }, position: at },
 ], connections: [
  wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'get', 'value', 'mul', 'a'), wire('c', 'half', 'value', 'mul', 'b'), wire('d', 'mul', 'result', 'set', 'value'),
  wire('e', 'big', 'flow', 'bad', 'flow'), wire('f', 'huge', 'value', 'bad', 'value'),
 ] } as BlueprintGraph;
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [g] }] });
 session.advance(0);
 expect(session.runBlueprint('fov', 'go').ok).toBe(true);
 const lens = (frame: ReturnType<typeof session.advance>) => (frame.scene.entities.find(e => e.id === 'camera_wide') as { lens: { fovDegrees: number } }).lens.fovDegrees;
 expect(lens(session.advance(16))).toBe(22.5);
 expect(session.runBlueprint('fov', 'big')).toMatchObject({ ok: false, error: { message: 'Invalid property value' } });
 expect(lens(session.advance(32))).toBe(22.5);
});

it('clears overrides when a show opens', () => {
 const session = start();
 session.advance(0, 0, W); session.advance(16, 16, W);
 const scene = session.inspect();
 expect(session.replaceScene(makeSmokeScene(), scene.revision).ok).toBe(true);
 expect(z(session.advance(32).scene)).toBe(0);
});
```

(This graph does not multiply by `deltaSeconds`, so each update moves `z` by 1 while W is held: ticks 0, 16, …, 160 are 11 moves. The last write is at 160 ms, so the commit happens at 410 ms and not at 409 ms.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit packages/session/test/property-nodes.test.ts packages/contracts/test/blueprint-ops.test.ts`
Expected: FAIL — unknown node types `entity.move`, `property.get`, `property.set`.

- [ ] **Step 3: Contracts — node definitions**

```ts
// packages/contracts/src/blueprint-nodes/properties.ts
import { z } from 'zod';
import { assetProperty, PROPERTY_KEYS } from '../property-registry';
import { defineNode, exit, IdSchema } from './define';

const target = z.strictObject({ entityId: IdSchema, property: z.enum(PROPERTY_KEYS) });
const fields = [{ key: 'entityId', label: 'Entity', kind: 'entity' }, { key: 'property', label: 'Property', kind: 'property' }] as const;
export const PROPERTY_NODES = [
 defineNode({ type: 'property.get', label: 'Get Asset Property', category: 'Scene', keywords: ['read', 'position', 'rotation', 'scale', 'property'], settings: target, ports: s => ({ inputs: {}, outputs: { value: assetProperty(s.property).type } }), defaults: refs => refs.entityId ? { entityId: refs.entityId, property: 'position' as const } : null, fields, dynamicPorts: true }),
 defineNode({ type: 'property.set', label: 'Set Asset Property', category: 'Scene', keywords: ['write', 'position', 'rotation', 'scale', 'property', 'transform'], settings: target, ports: s => ({ inputs: { flow: 'flow', value: assetProperty(s.property).type }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId, property: 'position' as const } : null, fields, dynamicPorts: true }),
 defineNode({ type: 'entity.move', label: 'Move Entity', category: 'Scene', keywords: ['translate', 'walk', 'wasd', 'offset', 'position'], settings: z.strictObject({ entityId: IdSchema, space: z.enum(['world', 'local']) }), ports: () => ({ inputs: { flow: 'flow', delta: 'vector3' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId, space: 'local' as const } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }, { key: 'space', label: 'Space', kind: 'space' }] }),
] as const;
```

In `index.ts`, add `...PROPERTY_NODES` after `...SCENE_NODES`. If `pnpm check` reports an import cycle or type error for `../property-registry` (it imports only types from `./types`), keep the import; the cycle check is a type-level one.

- [ ] **Step 4: Session — effects, evaluators, integration**

`blueprint.ts`:

```ts
import type { OverrideWrite } from './overrides';
export type BlueprintEffect =
 | { kind: 'setVisibility'; entityId: Id; visible: boolean }
 | { kind: 'toggleVisibility'; entityId: Id }
 | { kind: 'selectCamera'; outputId: Id; cameraId: Id }
 | OverrideWrite;
export const isOverrideEffect = (effect: BlueprintEffect): effect is OverrideWrite => effect.kind === 'setProperty' || effect.kind === 'moveEntity';
```

```ts
// packages/session/src/blueprint-eval/properties.ts
import { readProperty, type PropertyValue, type Vec3 } from '@opensekai/contracts';
import { applyOverrides } from '../overrides';
import type { EvaluatorTable } from './types';

export const PROPERTY_EVALUATORS = {
 'property.get': { data: (node, _o, _r, _s, env) => {
  const entity = env.scene?.entities.find(item => item.id === node.settings.entityId);
  const value = entity && readProperty(entity, node.settings.property);
  if (value === undefined) throw new RangeError('Property is unavailable');
  return value;
 } },
 'property.set': { flow: (node, c) => c.emit({ kind: 'setProperty', entityId: node.settings.entityId, property: node.settings.property, value: c.read('value') as PropertyValue }) },
 'entity.move': { flow: (node, c) => c.emit({ kind: 'moveEntity', entityId: node.settings.entityId, space: node.settings.space, delta: c.read('delta') as Vec3 }) },
} satisfies Partial<EvaluatorTable>;
```

(Remove the unused `applyOverrides` import if `pnpm check` flags it.) Spread `PROPERTY_EVALUATORS` into `EVALUATORS`.

`session.ts`:
- Import `applyOverrides, dropOverrides, EMPTY_OVERRIDES, takeIdle, writeOverride, type OverrideLayer` from `./overrides` and `isOverrideEffect` from `./blueprint`.
- Add `let overrides: OverrideLayer = EMPTY_OVERRIDES;` beside `persistent`.
- Replace the body of `stepBlueprints` so that each run applies scene effects to the scratch scene and override effects to a scratch layer, and both are kept only when the run passes:

```ts
    const stepBlueprints = (events: BlueprintEvent[], nowMs: number, env: Omit<RunEnv, 'deltaSeconds'>) => {
        let working: SceneView | null = null;
        let layer = overrides;
        const runs = runtime.step(events, nowMs, run => {
            if (run.effects.length === 0) return null;
            const sceneEffects = run.effects.filter(effect => !isOverrideEffect(effect));
            let scene = working ?? persistent;
            if (sceneEffects.length) { const next = applyEffects(scene, sceneEffects); if (!next.ok) return next.error; scene = next.data; }
            let nextLayer = layer;
            for (const effect of run.effects.filter(isOverrideEffect)) {
                const written = writeOverride(nextLayer, scene, effect, run.graphId, nowMs);
                if (!written.ok) return written.error;
                nextLayer = written.data;
            }
            if (sceneEffects.length) working = scene;
            layer = nextLayer;
            return null;
        }, env);
        overrides = layer;
        for (const run of runs) if (run.error) runtimeErrors.set(run.graphId, run.error); else runtimeErrors.delete(run.graphId);
        const changed = working !== null && JSON.stringify(working) !== JSON.stringify(persistent);
        return { runs, committed: changed ? commit(working!) : { ok: true, data: { revision: persistent.revision } } };
    };
    // Overrides with no write for 250 ms go to the persistent scene in one commit.
    const commitIdle = (nowMs: number) => {
        const idle = takeIdle(persistent, overrides, nowMs);
        overrides = idle.remaining;
        if (idle.operations.length === 0) return;
        const applied = applyOperations(persistent, idle.operations, persistent.revision + 1);
        const committed = applied.ok ? commit(applied.data) : applied;
        if (!committed.ok) for (const graphId of idle.graphIds) runtimeErrors.set(graphId, committed.error);
    };
```

  `applyEffects` receives only scene effects; narrow its parameter type to `Exclude<BlueprintEffect, OverrideWrite>[]` if `pnpm check` requires it.
- `advance`: pass `scene: applyOverrides(persistent, overrides)` in the env, call `commitIdle(elapsedMs)` right after the Blueprint step (inside the same `try`), and evaluate the frame and tracking from the overridden scene:

```ts
            const shown = applyOverrides(persistent, overrides);
            const scene = adapter.evaluate(shown, elapsedMs);
            …
            const live = tracking.evaluate(shown, trackingNowMs ?? elapsedMs, elapsedMs);
```

- `runBlueprint`: pass `{ held: new Set(), scene: applyOverrides(persistent, overrides) }`.
- `applyPatch`: after a successful commit, `overrides = dropOverrides(overrides, value.operations);`.
- `replaceScene`: on success, `overrides = EMPTY_OVERRIDES;`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit packages/session/test/property-nodes.test.ts packages/contracts/test/blueprint-ops.test.ts`
Expected: PASS.
Run: `pnpm test:unit` and `pnpm check` → all pass, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/session
git commit -m "Add asset property nodes and Move Entity over the override layer"
```

---

### Task 6: Native key monitor

**Files:**
- Create: `apps/desktop/src-tauri/src/input/monitor.rs`
- Modify: `apps/desktop/src-tauri/src/input.rs` (add `pub mod monitor;`)
- Test: unit tests inside `monitor.rs`

**Interfaces:**
- Produces:
  - `pub enum MonitorStatus { Observing, NoAccess, Unsupported }`
  - `pub trait KeyMonitor: Send + Sync { fn set_watched(&self, codes: &BTreeSet<String>); fn held(&self) -> Vec<String>; fn status(&self) -> MonitorStatus; }`
  - `pub struct HeldKeys` (pure bookkeeping): `set_watched(&mut self, codes)`, `key(&mut self, code: &str, down: bool)`, `clear(&mut self)`, `snapshot(&self) -> Vec<String>` (sorted, ≤ 16)
  - `pub fn dom_code(mac_keycode: u16) -> Option<&'static str>`
  - `pub struct NoKeyMonitor` (status `Unsupported`, never holds keys); `pub fn platform_monitor() -> Arc<dyn KeyMonitor>` (macOS: `MacKeyMonitor`; other: `NoKeyMonitor`)

- [ ] **Step 1: Write the failing tests** (bottom of `monitor.rs`; create the file with only the tests and `use super::*;` first)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn set(codes: &[&str]) -> BTreeSet<String> { codes.iter().map(|c| c.to_string()).collect() }

    #[test]
    fn reports_only_watched_keys_that_are_down() {
        let mut keys = HeldKeys::default();
        keys.set_watched(&set(&["KeyW", "KeyS"]));
        keys.key("KeyW", true);
        keys.key("KeyQ", true);
        assert_eq!(keys.snapshot(), vec!["KeyW".to_string()]);
        keys.key("KeyW", false);
        assert!(keys.snapshot().is_empty());
    }

    #[test]
    fn clears_held_keys_on_disable_and_when_unwatched() {
        let mut keys = HeldKeys::default();
        keys.set_watched(&set(&["KeyW", "KeyS"]));
        keys.key("KeyW", true);
        keys.key("KeyS", true);
        keys.set_watched(&set(&["KeyS"]));
        assert_eq!(keys.snapshot(), vec!["KeyS".to_string()]);
        keys.clear();
        assert!(keys.snapshot().is_empty());
    }

    #[test]
    fn maps_mac_keycodes_to_dom_codes() {
        assert_eq!(dom_code(0x0D), Some("KeyW"));
        assert_eq!(dom_code(0x00), Some("KeyA"));
        assert_eq!(dom_code(0x01), Some("KeyS"));
        assert_eq!(dom_code(0x02), Some("KeyD"));
        assert_eq!(dom_code(0x31), Some("Space"));
        assert_eq!(dom_code(0x7E), Some("ArrowUp"));
        assert_eq!(dom_code(0x38), None); // Shift is not in the code list
    }

    #[test]
    fn the_stub_reports_unsupported_and_no_keys() {
        let monitor = NoKeyMonitor;
        monitor.set_watched(&set(&["KeyW"]));
        assert!(monitor.held().is_empty());
        assert!(matches!(monitor.status(), MonitorStatus::Unsupported));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p opensekai-desktop --lib input::monitor`
Expected: FAIL to compile — `HeldKeys`, `dom_code`, `NoKeyMonitor` are not defined.

- [ ] **Step 3: Implement the portable part**

```rust
// apps/desktop/src-tauri/src/input/monitor.rs
//! Observes held keys in all apps without consuming them. Only watched keys are kept.
use std::collections::BTreeSet;
use std::sync::Arc;

pub const MAX_HELD: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MonitorStatus { Observing, NoAccess, Unsupported }

pub trait KeyMonitor: Send + Sync {
    /// Starts observation for a non-empty set and stops it for an empty one.
    fn set_watched(&self, codes: &BTreeSet<String>);
    fn held(&self) -> Vec<String>;
    fn status(&self) -> MonitorStatus;
}

#[derive(Default)]
pub struct HeldKeys { watched: BTreeSet<String>, down: BTreeSet<String> }
impl HeldKeys {
    pub fn set_watched(&mut self, codes: &BTreeSet<String>) {
        self.watched = codes.clone();
        self.down.retain(|code| codes.contains(code));
    }
    pub fn key(&mut self, code: &str, down: bool) {
        if !self.watched.contains(code) { return; }
        if down { self.down.insert(code.to_string()); } else { self.down.remove(code); }
    }
    pub fn clear(&mut self) { self.down.clear(); }
    pub fn snapshot(&self) -> Vec<String> { self.down.iter().take(MAX_HELD).cloned().collect() }
}

/// macOS virtual key codes (Events.h, kVK_*) for the codes in fixtures/protocol/keystroke-codes.json.
pub fn dom_code(keycode: u16) -> Option<&'static str> {
    Some(match keycode {
        0x00 => "KeyA", 0x0B => "KeyB", 0x08 => "KeyC", 0x02 => "KeyD", 0x0E => "KeyE", 0x03 => "KeyF", 0x05 => "KeyG",
        0x04 => "KeyH", 0x22 => "KeyI", 0x26 => "KeyJ", 0x28 => "KeyK", 0x25 => "KeyL", 0x2E => "KeyM", 0x2D => "KeyN",
        0x1F => "KeyO", 0x23 => "KeyP", 0x0C => "KeyQ", 0x0F => "KeyR", 0x01 => "KeyS", 0x11 => "KeyT", 0x20 => "KeyU",
        0x09 => "KeyV", 0x0D => "KeyW", 0x07 => "KeyX", 0x10 => "KeyY", 0x06 => "KeyZ",
        0x1D => "Digit0", 0x12 => "Digit1", 0x13 => "Digit2", 0x14 => "Digit3", 0x15 => "Digit4", 0x17 => "Digit5",
        0x16 => "Digit6", 0x1A => "Digit7", 0x1C => "Digit8", 0x19 => "Digit9",
        0x52 => "Numpad0", 0x53 => "Numpad1", 0x54 => "Numpad2", 0x55 => "Numpad3", 0x56 => "Numpad4", 0x57 => "Numpad5",
        0x58 => "Numpad6", 0x59 => "Numpad7", 0x5B => "Numpad8", 0x5C => "Numpad9",
        0x7A => "F1", 0x78 => "F2", 0x63 => "F3", 0x76 => "F4", 0x60 => "F5", 0x61 => "F6", 0x62 => "F7", 0x64 => "F8",
        0x65 => "F9", 0x6D => "F10", 0x67 => "F11", 0x6F => "F12", 0x69 => "F13", 0x6B => "F14", 0x71 => "F15",
        0x6A => "F16", 0x40 => "F17", 0x4F => "F18", 0x50 => "F19", 0x5A => "F20",
        0x31 => "Space", 0x24 => "Enter", 0x33 => "Backspace", 0x30 => "Tab",
        0x7E => "ArrowUp", 0x7D => "ArrowDown", 0x7B => "ArrowLeft", 0x7C => "ArrowRight",
        _ => return None,
    })
}

pub struct NoKeyMonitor;
impl KeyMonitor for NoKeyMonitor {
    fn set_watched(&self, _: &BTreeSet<String>) {}
    fn held(&self) -> Vec<String> { vec![] }
    fn status(&self) -> MonitorStatus { MonitorStatus::Unsupported }
}

pub fn platform_monitor() -> Arc<dyn KeyMonitor> {
    #[cfg(target_os = "macos")]
    { Arc::new(macos::MacKeyMonitor::default()) }
    #[cfg(not(target_os = "macos"))]
    { Arc::new(NoKeyMonitor) }
}
```

In `input.rs`, add `pub mod monitor;` at the top. (`input.rs` with a sibling directory `input/` holding `monitor.rs` is the standard Rust layout.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p opensekai-desktop --lib input::monitor`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement the macOS tap** (append to `monitor.rs`)

```rust
#[cfg(target_os = "macos")]
mod macos {
    use super::{dom_code, HeldKeys, KeyMonitor, MonitorStatus};
    use std::collections::BTreeSet;
    use std::ffi::c_void;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    type Ref = *mut c_void;
    type Callback = extern "C" fn(Ref, u32, Ref, *mut c_void) -> Ref;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(tap: u32, place: u32, options: u32, mask: u64, callback: Callback, refcon: *mut c_void) -> Ref;
        fn CGEventTapEnable(tap: Ref, enable: bool);
        fn CGEventGetIntegerValueField(event: Ref, field: u32) -> i64;
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: *const c_void;
        fn CFMachPortCreateRunLoopSource(allocator: *const c_void, port: Ref, order: isize) -> Ref;
        fn CFMachPortInvalidate(port: Ref);
        fn CFRunLoopGetCurrent() -> Ref;
        fn CFRunLoopAddSource(run_loop: Ref, source: Ref, mode: *const c_void);
        fn CFRunLoopRun();
        fn CFRunLoopStop(run_loop: Ref);
        fn CFRelease(object: *const c_void);
    }
    const SESSION_TAP: u32 = 1; // kCGSessionEventTap
    const HEAD_INSERT: u32 = 0; // kCGHeadInsertEventTap
    const LISTEN_ONLY: u32 = 1; // kCGEventTapOptionListenOnly
    const KEY_DOWN: u32 = 10;
    const KEY_UP: u32 = 11;
    const DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
    const KEYCODE_FIELD: u32 = 9; // kCGKeyboardEventKeycode

    /// A CoreFoundation pointer that the owning thread hands to another thread only to stop it.
    #[derive(Clone, Copy)]
    struct Shared(Ref);
    unsafe impl Send for Shared {}

    struct Tap { keys: Arc<Mutex<HeldKeys>>, port: Mutex<Option<Shared>> }

    extern "C" fn callback(_: Ref, kind: u32, event: Ref, refcon: *mut c_void) -> Ref {
        // SAFETY: refcon is the Tap that the tap thread keeps alive until the run loop exits.
        let tap = unsafe { &*(refcon as *const Tap) };
        let mut keys = tap.keys.lock().unwrap_or_else(|e| e.into_inner());
        match kind {
            KEY_DOWN | KEY_UP => {
                let keycode = unsafe { CGEventGetIntegerValueField(event, KEYCODE_FIELD) } as u16;
                if let Some(code) = dom_code(keycode) { keys.key(code, kind == KEY_DOWN); }
            }
            DISABLED_BY_TIMEOUT | DISABLED_BY_USER_INPUT => {
                // A key up may be lost while the tap is off.
                keys.clear();
                if let Some(Shared(port)) = *tap.port.lock().unwrap_or_else(|e| e.into_inner()) {
                    unsafe { CGEventTapEnable(port, true) };
                }
            }
            _ => {}
        }
        // A listen-only tap ignores the return value; the event passes unchanged.
        event
    }

    #[derive(Default)]
    struct State { run_loop: Option<Shared>, running: bool, requested: bool, no_access: bool, last_check: Option<Instant> }

    #[derive(Default)]
    pub struct MacKeyMonitor { keys: Arc<Mutex<HeldKeys>>, state: Arc<Mutex<State>>, watched: Mutex<BTreeSet<String>> }

    impl MacKeyMonitor {
        fn start(&self) {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.running { return; }
            if !unsafe { CGPreflightListenEventAccess() } {
                if !state.requested { state.requested = true; unsafe { CGRequestListenEventAccess() }; }
                state.no_access = true;
                return;
            }
            state.no_access = false;
            state.running = true;
            let (keys, shared_state) = (self.keys.clone(), self.state.clone());
            std::thread::Builder::new().name("opensekai-key-monitor".into()).spawn(move || {
                let tap = Box::new(Tap { keys: keys.clone(), port: Mutex::new(None) });
                let refcon = &*tap as *const Tap as *mut c_void;
                let mask = (1u64 << KEY_DOWN) | (1u64 << KEY_UP);
                let port = unsafe { CGEventTapCreate(SESSION_TAP, HEAD_INSERT, LISTEN_ONLY, mask, callback, refcon) };
                if port.is_null() {
                    let mut state = shared_state.lock().unwrap_or_else(|e| e.into_inner());
                    state.running = false;
                    state.no_access = true;
                    return;
                }
                *tap.port.lock().unwrap_or_else(|e| e.into_inner()) = Some(Shared(port));
                unsafe {
                    let source = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
                    let run_loop = CFRunLoopGetCurrent();
                    CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
                    CGEventTapEnable(port, true);
                    shared_state.lock().unwrap_or_else(|e| e.into_inner()).run_loop = Some(Shared(run_loop));
                    CFRunLoopRun();
                    CGEventTapEnable(port, false);
                    CFMachPortInvalidate(port);
                    CFRelease(source);
                    CFRelease(port);
                }
                keys.lock().unwrap_or_else(|e| e.into_inner()).clear();
                let mut state = shared_state.lock().unwrap_or_else(|e| e.into_inner());
                state.running = false;
                state.run_loop = None;
                drop(tap);
            }).ok();
        }
        fn stop(&self) {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(Shared(run_loop)) = state.run_loop { unsafe { CFRunLoopStop(run_loop) }; }
        }
    }

    impl KeyMonitor for MacKeyMonitor {
        fn set_watched(&self, codes: &BTreeSet<String>) {
            *self.watched.lock().unwrap_or_else(|e| e.into_inner()) = codes.clone();
            self.keys.lock().unwrap_or_else(|e| e.into_inner()).set_watched(codes);
            if codes.is_empty() { self.stop(); } else { self.start(); }
        }
        fn held(&self) -> Vec<String> {
            // After the operator grants access, the next clock tick (at most once a second) starts the tap.
            let retry = {
                let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
                let due = state.no_access && !state.running && state.last_check.is_none_or(|t| t.elapsed() >= Duration::from_secs(1));
                if due { state.last_check = Some(Instant::now()); }
                due
            };
            if retry && !self.watched.lock().unwrap_or_else(|e| e.into_inner()).is_empty() { self.start(); }
            self.keys.lock().unwrap_or_else(|e| e.into_inner()).snapshot()
        }
        fn status(&self) -> MonitorStatus {
            if self.state.lock().unwrap_or_else(|e| e.into_inner()).no_access { MonitorStatus::NoAccess } else { MonitorStatus::Observing }
        }
    }
}
```

Note the start/stop race: a `stop()` that runs before the thread stores its run loop has no effect, and the tap stays on with an empty watched set. That is harmless, because `HeldKeys` keeps only watched keys; the next non-empty `set_watched` then sees `running == true` and reuses the tap. If `Option::is_none_or` is unavailable on the pinned toolchain (`rust-toolchain.toml`), use `map_or(true, …)`.

- [ ] **Step 6: Build and run the tests**

Run: `cargo test -p opensekai-desktop --lib input::monitor` → PASS, 4 tests.
Run: `cargo clippy -p opensekai-desktop -- -D warnings` (if the repo runs clippy in CI; check `.github/workflows`) → no warnings.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/input.rs apps/desktop/src-tauri/src/input/monitor.rs
git commit -m "Add a listen-only key monitor for watched keys"
```

---

### Task 7: Host plumbing — watched set, clock `held`, warning, Open Settings

**Files:**
- Modify: `apps/desktop/src-tauri/src/service/mod.rs` (`KnownKeystrokes`, `Shared`, `learn_locked`, `sync_keystrokes`, `relearn_keystrokes`, clock call at ~line 1196, `ServicePorts`)
- Modify: `apps/desktop/src-tauri/src/service/router.rs` (~line 130 edit reply; ~line 170 `appStatus`)
- Modify: `apps/desktop/src-tauri/src/bootstrap.rs:170`, `lib.rs` (command + handler), `build.rs` (command list), `capabilities/editor.json`
- Test: `apps/desktop/src-tauri/tests/held_keys_integration.rs`

**Interfaces:**
- Consumes: Task 3 (`InputUpdate.held`, `BlueprintEditResult.held_keys`), Task 6 (`KeyMonitor`, `MonitorStatus`, `platform_monitor`).
- Produces: `ServicePorts::set_key_monitor(&self, monitor: Arc<dyn KeyMonitor>)`; Tauri command `open_input_monitoring_settings`; app status warning `{ code, message, ids: ["input-monitoring"] }`.

- [ ] **Step 1: Write the failing integration test**

This is an integration test because it checks the real WebSocket process boundary: the publisher reply, the host's learned state, the clock message, and the status call.

```rust
// apps/desktop/src-tauri/tests/held_keys_integration.rs
// Copy the helpers `service`, `send`, `recv`, `auth`, `frame`, `recv_non_clock` from keystroke_integration.rs.
use opensekai_desktop_lib::input::monitor::{KeyMonitor, MonitorStatus};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

struct FakeMonitor { watched: Mutex<Vec<BTreeSet<String>>>, status: MonitorStatus }
impl KeyMonitor for FakeMonitor {
    fn set_watched(&self, codes: &BTreeSet<String>) { self.watched.lock().unwrap().push(codes.clone()); }
    fn held(&self) -> Vec<String> {
        let last = self.watched.lock().unwrap().last().cloned().unwrap_or_default();
        if last.contains("KeyW") { vec!["KeyW".into()] } else { vec![] }
    }
    fn status(&self) -> MonitorStatus { self.status }
}

async fn edit_reply_with_held(o: &mut Socket, p: &mut Socket, held: Value) {
    send(o, json!({"kind":"call","requestId":"edit","method":"blueprintEdit","params":{"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}})).await;
    let relayed = recv_non_clock(p).await;
    send(p, json!({"kind":"reply","requestId":relayed["requestId"],"result":{"ok":true,"data":{"revision":1,"keystrokes":[],"heldKeys":held}}})).await;
    assert_eq!(recv_non_clock(o).await["requestId"], "edit");
}

#[tokio::test]
async fn watched_keys_from_an_edit_reply_reach_the_monitor_and_held_keys_ride_the_clock() {
    let (_d, s) = service().await;
    let monitor = Arc::new(FakeMonitor { watched: Mutex::default(), status: MonitorStatus::Observing });
    s.ports().set_key_monitor(monitor.clone());
    let pd = s.publisher_descriptor();
    let mut p = auth(&pd).await;
    let mut o = auth(&s.operator_descriptor()).await;
    edit_reply_with_held(&mut o, &mut p, json!(["KeyS", "KeyW"])).await;
    let expected: BTreeSet<String> = ["KeyS", "KeyW"].iter().map(|s| s.to_string()).collect();
    assert_eq!(monitor.watched.lock().unwrap().last(), Some(&expected));
    // Answer clocks until one carries the held key.
    let mut sequence = 1;
    let held = loop {
        let clock = recv(&mut p).await;
        if clock["kind"] == "clock" {
            if !clock["input"]["held"].is_null() { break clock["input"]["held"].clone(); }
            send(&mut p, frame(&pd.session_id, sequence)).await;
            sequence += 1;
        }
    };
    assert_eq!(held, json!(["KeyW"]));
    drop(p);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(monitor.watched.lock().unwrap().last().unwrap().is_empty());
    s.shutdown().await.unwrap();
}

#[tokio::test]
async fn status_warns_while_watched_keys_cannot_be_observed() {
    let (_d, s) = service().await;
    s.ports().set_key_monitor(Arc::new(FakeMonitor { watched: Mutex::default(), status: MonitorStatus::NoAccess }));
    let mut p = auth(&s.publisher_descriptor()).await;
    let mut o = auth(&s.operator_descriptor()).await;
    send(&mut o, json!({"kind":"call","requestId":"s0","method":"appStatus","params":{}})).await;
    assert_eq!(recv_non_clock(&mut o).await["result"]["data"]["warnings"], json!([]));
    edit_reply_with_held(&mut o, &mut p, json!(["KeyW"])).await;
    send(&mut o, json!({"kind":"call","requestId":"s1","method":"appStatus","params":{}})).await;
    let warnings = recv_non_clock(&mut o).await["result"]["data"]["warnings"].clone();
    assert_eq!(warnings, json!([{"code":"FORBIDDEN","message":"Input Monitoring is off","ids":["input-monitoring"]}]));
    s.shutdown().await.unwrap();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p opensekai-desktop --test held_keys_integration`
Expected: FAIL to compile — `set_key_monitor` does not exist.

- [ ] **Step 3: Implement the host plumbing** (`service/mod.rs`)

1. `KnownKeystrokes` gains `watched: BTreeSet<String>`.
2. `Shared` gains `monitor: Mutex<Arc<dyn crate::input::monitor::KeyMonitor>>`, initialized with `Mutex::new(Arc::new(crate::input::monitor::NoKeyMonitor))` beside `keystrokes:` (~line 461).
3. `learn_keystrokes(&self, publisher, revision, reported, watched: BTreeSet<String>)` and `learn_locked(known, publisher, revision, reported, watched)`; in the `newer` branch also set `known.watched = watched;`. In `relearn_keystrokes`, parse the watched list from the inspect reply with an empty default:
   ```rust
   let held = data.get("heldKeys").cloned().map(serde_json::from_value::<Vec<String>>).transpose().ok()?.unwrap_or_default();
   Some((revision, serde_json::from_value::<Vec<String>>(list).ok()?, held))
   ```
   pass `held.into_iter().collect()` to `learn_locked`, and in the `(None, _) if same_publisher …` branch also `known.watched.clear();`.
4. `sync_keystrokes`: inside `work`, after the gate is taken, apply the watched set (the monitor is passive, so keystroke capture does not affect it):
   ```rust
   let watched = if lock(&self.inner).publisher.is_some() { lock(&self.keystrokes_known).watched.clone() } else { BTreeSet::new() };
   lock(&self.monitor).clone().set_watched(&watched);
   ```
5. A clock input helper on `Shared`, used at the clock call (~line 1196) in place of `lock(&shared.input).drain()`:
   ```rust
   fn clock_input(&self) -> Option<InputUpdate> {
       let mut update = lock(&self.input).drain();
       let held = lock(&self.monitor).clone().held();
       if !held.is_empty() {
           match update.as_mut() {
               Some(update) => update.held = held,
               None => update = Some(InputUpdate { events: vec![], held }),
           }
       }
       update
   }
   ```
6. `ServicePorts::set_key_monitor`, beside `set_keystroke_registrar`:
   ```rust
   pub fn set_key_monitor(&self, monitor: Arc<dyn crate::input::monitor::KeyMonitor>) {
       *lock(&self.shared.monitor) = monitor;
       if let Ok(runtime) = tokio::runtime::Handle::try_current() {
           let shared = self.shared.clone();
           runtime.spawn(async move { shared.sync_keystrokes().await });
       }
   }
   ```

`service/router.rs`:
- Edit reply (~line 130): pass `data.held_keys.into_iter().collect()` as the new `watched` argument.
- `appStatus` (~line 170): read the watched state and the monitor status **before** `let inner = lock(&self.inner);` (`relearn_keystrokes` takes `keystrokes_known` before `inner`; taking them in the other order can deadlock):
  ```rust
  let watching = !lock(&self.keystrokes_known).watched.is_empty();
  let monitor = lock(&self.monitor).clone().status();
  ```
  then build `warnings` as the keystroke warnings followed by:
  ```rust
  .chain(match (watching && inner.publisher.is_some(), monitor) {
      (true, MonitorStatus::NoAccess) => Some(AppError { code: ErrorCode::Forbidden, message: "Input Monitoring is off".into(), ids: vec!["input-monitoring".into()] }),
      (true, MonitorStatus::Unsupported) => Some(AppError { code: ErrorCode::Unsupported, message: "Held keys are unavailable on this platform".into(), ids: vec!["input-monitoring".into()] }),
      _ => None,
  })
  ```

`bootstrap.rs` (~line 170, after `set_keystroke_registrar`): `service.ports().set_key_monitor(crate::input::monitor::platform_monitor());`

`lib.rs`: add the command and register it in `generate_handler!`:

```rust
#[tauri::command]
fn open_input_monitoring_settings(window: tauri::WebviewWindow) -> Result<(), AppError> {
    require_window_label(window.label(), "editor")?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
        .spawn()
        .map_err(|_| AppError { code: ErrorCode::Unavailable, message: "Settings unavailable".into(), ids: vec![] })?;
    Ok(())
}
```

(Match the `AppError`/`ErrorCode` paths that `lib.rs` already uses.) Add `"open_input_monitoring_settings"` to the `AppManifest::commands` list in `build.rs`, and `"allow-open-input-monitoring-settings"` to `capabilities/editor.json` beside `allow-set-keystroke-capture`. The build regenerates `permissions/autogenerated/open_input_monitoring_settings.toml`; commit it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p opensekai-desktop --test held_keys_integration` → PASS, 2 tests.
Run: `cargo test -p opensekai-desktop` → all pass (including `keystroke_integration`).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "Send held keys on the clock and warn when they cannot be observed"
```

---

### Task 8: Editor — fields, typed ports, socket color, warning row

**Files:**
- Modify: `apps/desktop/src/blueprints/fields.ts`, `apps/desktop/src/blueprints/rete-editor.ts:28-40,158-170`, `apps/desktop/src/components/BlueprintNodeFields.svelte`, `apps/desktop/src/components/BlueprintPanel.svelte`, `apps/desktop/src/app.css:55-57`
- Test: `apps/desktop/test/blueprint-fields.test.ts` (append), `apps/desktop/test/rete-editor.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 `propertiesFor`, `PROPERTY_KEYS`; Task 4/5 node types and field kinds.
- Produces: `keyLabel(code: string): string`; `keyOptions(): { value: string; label: string }[]`; `propertyOptions(scene, entityId): { value: PropertyKey; label: string }[]`; `fitPropertySettings(settings, scene): settings` (resets `property` to `position` when the entity kind lacks it).

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/test/blueprint-fields.test.ts`:

```ts
import { makeSmokeScene } from '@opensekai/contracts';
import { fitPropertySettings, keyLabel, keyOptions, propertyOptions } from '../src/blueprints/fields';

it('labels key codes for the key picker', () => {
 expect(keyLabel('KeyW')).toBe('W');
 expect(keyLabel('Digit1')).toBe('1');
 expect(keyLabel('Numpad5')).toBe('Numpad 5');
 expect(keyLabel('ArrowUp')).toBe('Up Arrow');
 expect(keyLabel('Space')).toBe('Space');
 expect(keyOptions()).toContainEqual({ value: 'KeyW', label: 'W' });
});

it('lists the properties of the chosen entity and fixes a property that does not apply', () => {
 const scene = makeSmokeScene();
 expect(propertyOptions(scene, 'camera_wide').map(o => o.value)).toContain('fovDegrees');
 expect(propertyOptions(scene, 'performer').map(o => o.value)).not.toContain('fovDegrees');
 expect(fitPropertySettings({ entityId: 'performer', property: 'fovDegrees' }, scene)).toEqual({ entityId: 'performer', property: 'position' });
 expect(fitPropertySettings({ entityId: 'camera_wide', property: 'fovDegrees' }, scene)).toEqual({ entityId: 'camera_wide', property: 'fovDegrees' });
});
```

Append to `apps/desktop/test/rete-editor.test.ts`:

```ts
it('retypes a port and removes its wire when a property changes type', async () => {
 const g = { schemaVersion: 1 as const, id: 'p', name: 'P', enabled: true, variables: [], nodes: [
  { id: 'make', version: 1 as const, type: 'vector3.make' as const, settings: {}, position: { x: 0, y: 0 } },
  { id: 'set', version: 1 as const, type: 'property.set' as const, settings: { entityId: 'reference', property: 'position' as const }, position: { x: 200, y: 0 } },
 ], connections: [{ id: 'w', sourceNodeId: 'make', sourcePort: 'value', targetNodeId: 'set', targetPort: 'value' }] };
 let area!: { parent: unknown };
 const editor = await mountReteBlueprint(element() as unknown as HTMLElement, g as never, { onSelect() {}, onOps() {} }, { render: false, inspect: value => { area = value as never; } });
 const next = applyBlueprintOps([g as never], [{ kind: 'setNodeSettings', graphId: 'p', nodeId: 'set', settings: { entityId: 'reference', property: 'visible' } }]);
 if (!next.ok) throw new Error();
 await editor.show(next.data[0]!);
 const rete = (area.parent as { getConnections(): unknown[]; getNode(id: string): { inputs: Record<string, { socket: { name: string } }> } });
 expect(rete.getConnections()).toEqual([]);
 expect(rete.getNode('set').inputs.value!.socket.name).toBe('Boolean');
});
```

(If the area plugin does not expose the editor as `parent`, read how the existing tests in this file reach the `NodeEditor` and use the same path; the assertions stay the same.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit apps/desktop/test/blueprint-fields.test.ts apps/desktop/test/rete-editor.test.ts`
Expected: FAIL — `keyLabel` and the other helpers are not exported; the retype test finds the wire still present or the socket still `Vector3`.

- [ ] **Step 3: Implement the helpers** (`apps/desktop/src/blueprints/fields.ts`)

```ts
import { KEYSTROKE_CODES, propertiesFor, type PropertyKey, type SceneView } from '@opensekai/contracts';

export function keyLabel(code: string): string {
 if (code.startsWith('Key')) return code.slice(3);
 if (code.startsWith('Digit')) return code.slice(5);
 if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
 if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
 return code;
}
export const keyOptions = () => KEYSTROKE_CODES.map(code => ({ value: code, label: keyLabel(code) }));
const kindOf = (scene: SceneView | null, entityId: string) => scene?.entities.find(entity => entity.id === entityId)?.kind;
export function propertyOptions(scene: SceneView | null, entityId: string): { value: PropertyKey; label: string }[] {
 const kind = kindOf(scene, entityId);
 return kind ? propertiesFor(kind).map(property => ({ value: property.key, label: property.label })) : [];
}
export function fitPropertySettings<S extends { entityId: string; property: PropertyKey }>(settings: S, scene: SceneView | null): S {
 const options = propertyOptions(scene, settings.entityId);
 return options.length === 0 || options.some(option => option.value === settings.property) ? settings : { ...settings, property: 'position' };
}
```

- [ ] **Step 4: Implement the fields and the retype**

`BlueprintNodeFields.svelte`: add these branches before the final `{:else}`:

```svelte
 {:else if field.kind === 'key'}
  <Select label={field.label} value={String(settings[field.key])} options={keyOptions()} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'property'}
  <Select label={field.label} value={String(settings[field.key])} options={propertyOptions(scene, String(settings.entityId))} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'space'}
  <Select label={field.label} value={String(settings[field.key])} options={[{ value: 'world', label: 'World' }, { value: 'local', label: 'Local' }]} onchange={event => set(field.key, event.currentTarget.value)} />
```

and change `set` so that an entity change on a property node keeps a valid property:

```ts
 const set = (key: string, value: unknown) => {
  const next = { ...settings, [key]: value } as BlueprintNode['settings'];
  onsettings(node.type === 'property.get' || node.type === 'property.set' ? fitPropertySettings(next as never, scene) : next);
 };
```

(import `keyOptions`, `propertyOptions`, `fitPropertySettings` from `../blueprints/fields`.)

`rete-editor.ts`:
- Add the socket: `vector3: new ClassicPreset.Socket('Vector3'),` to `sockets`.
- In `syncPorts`, remove a port whose type changed, so the re-add loop creates it with the new socket:

```ts
  for (const name of Object.keys(this.inputs)) { const type = ownPort(ports, 'inputs', name); if (!type || this.inputs[name]!.socket !== sockets[type]) this.removeInput(name); }
  for (const name of Object.keys(this.outputs)) { const type = ownPort(ports, 'outputs', name); if (!type || this.outputs[name]!.socket !== sockets[type]) this.removeOutput(name); }
```

- In `updateNode`, remove a wire that no longer type-checks, not only one whose port is missing:

```ts
  for (const c of editor.getConnections()) {
   if (c.source !== data.id && c.target !== data.id) continue;
   const source = c.source === data.id ? data : (editor.getNode(c.source) as GraphNode | undefined)?.data;
   const target = c.target === data.id ? data : (editor.getNode(c.target) as GraphNode | undefined)?.data;
   if (!source || !target || !connectionType(source, String(c.sourceOutput), target, String(c.targetInput))) await removeWire(c.id);
  }
```

(import `connectionType` from `@opensekai/contracts`.)

`app.css` (after line 56): `.bp-socket[data-kind=vector3]{--bp-socket:#8f74b8}`

`BlueprintPanel.svelte`: show the monitor warning above the workspace, with the action on macOS:

```svelte
 {@const inputWarning = status?.warnings.find(warning => warning.ids.includes('input-monitoring'))}
 {#if inputWarning}
  <div class="blueprint-warning" role="alert">{inputWarning.message}{#if inputWarning.code === 'FORBIDDEN'}<Button variant="secondary" onclick={openInputSettings}>Open Settings</Button>{/if}</div>
 {/if}
```

with

```ts
 function openInputSettings() { try { void invoke('open_input_monitoring_settings').catch(() => {}); } catch { /* outside Tauri */ } }
```

(`invoke` from `@tauri-apps/api/core`, as `KeystrokeField.svelte` uses it; place the markup between the `<header class="blueprint-toolbar">` and `<div class="blueprint-workspace">`; if `{@const}` is not allowed at that level, compute `inputWarning` with `$derived` in the script.) Style `.blueprint-warning` as one compact row with the existing warning color tokens in the file; no icon or badge.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit apps/desktop/test/blueprint-fields.test.ts apps/desktop/test/rete-editor.test.ts` → PASS.
Run: `pnpm test:unit` and `pnpm check` → all pass, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/test
git commit -m "Edit held-key and property nodes in the Blueprint editor"
```

---

### Task 9: MCP — the property registry in the node resource

**Files:**
- Modify: `apps/mcp/src/resources.ts:20-21`
- Test: `apps/mcp/test/stdio-roundtrip.integration.test.ts:22-23` (extend)

**Interfaces:**
- Consumes: Task 1 `blueprintPropertyCatalog()`.
- Produces: resource JSON `{ nodes: […], properties: [{ key, label, kinds, type, rule }] }`.

- [ ] **Step 1: Write the failing test** — after the existing `catalog.nodes` assertion add:

```ts
  expect(catalog.properties).toContainEqual({ key: 'fovDegrees', label: 'Field of View', kinds: ['camera'], type: 'number', rule: { kind: 'range', min: 1, max: 179 } });
  expect(catalog.nodes.map((n:{type:string})=>n.type)).toEqual(expect.arrayContaining(['event.update', 'input.keyAxis', 'entity.move', 'property.set']));
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project integration apps/mcp/test/stdio-roundtrip.integration.test.ts`
Expected: FAIL — `catalog.properties` is undefined.

- [ ] **Step 3: Implement**

```ts
 server.registerResource('blueprint-nodes', 'opensekai://blueprint-nodes', {mimeType:'application/json'}, async uri =>
  ({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify({nodes:blueprintNodeCatalog(),properties:blueprintPropertyCatalog()})}]}));
```

(import `blueprintPropertyCatalog` from `@opensekai/contracts`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run --project integration apps/mcp/test/stdio-roundtrip.integration.test.ts` → PASS.
Check `apps/mcp/test/resource-limits.test.ts` still passes (`pnpm test:unit`); if it bounds the resource size, the registry adds well under 1 KB.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp
git commit -m "List the asset property registry in the MCP node resource"
```

---

### Task 10: Live macOS verification, evidence, parity, and spec sync

**Files:**
- Create: `docs/evaluation/continuous-blueprints.md` (+ screenshots)
- Modify: `docs/warudo-parity.md` (BP-01, BP-05, BP-06, and the Different note on hotkeys), `spdd/prompt/2026-10-12-continuous-blueprints.md` (sync any rulings)

This task needs the operator's machine: the running app, the macOS permission prompt, and OBS. Use computer-use or ask the operator for each physical step. Do not start a live stream.

- [ ] **Step 1: Full suites**

Run: `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo test --workspace`
Expected: 0 type errors; all tests pass. Record the counts.

- [ ] **Step 2: Build and start the app**

Run: `pnpm dev:desktop` (or reuse a running dev app after a restart that picks up the native changes). Record the commit (`git rev-parse --short HEAD`) and the renderer backend from `app_status`.

- [ ] **Step 3: Build the WASD graph**

In the Blueprint panel, or with `blueprint_edit` through the MCP CLI, build: On Update → Move Entity (character, Local), delta = Scale Vector3(Make Vector3(Key Axis(A, D), Number 0, Key Axis(S, W)), Multiply(Number 1.5, deltaSeconds)). Check that the Input category lists Is Key Held and Key Axis, that the Key fields list W/A/S/D, and that the Vector3 sockets have their own color. Screenshot the graph.

- [ ] **Step 4: Permission**

On the first held-key graph, macOS asks for Input Monitoring. Before the grant, the Blueprint panel shows `Input Monitoring is off` with **Open Settings**; **Open Settings** opens the Input Monitoring pane. Grant access for the dev app. Within about 1 s the warning goes away. Screenshot both states.

- [ ] **Step 5: Pass-through movement**

Open TextEdit and focus it. Hold W for about 2 s: the character moves forward in the Scene preview and in the OBS output (OBS browser source on `output_main`), and TextEdit receives `wwww…`. Hold A and D: the character moves sideways. Release: the character stops. Record `app_status` `revision` before the hold, during it, and 1 s after the release (expected: the same during the hold, +1 after). Check that the Inspector shows the new position after the release.

- [ ] **Step 6: Persistence and conflict**

Save the show, open it again: the character keeps the committed position. Drag the character with the gizmo while holding W: the drag wins; after the release the character stays where the drag left it.

- [ ] **Step 7: Evidence, parity, spec**

Write `docs/evaluation/continuous-blueprints.md` (ASD-STE100): commit, platform, backend, steps, results, revision counts, screenshots, and the known gaps (Windows monitor is a stub; secure input hides keys). Update `docs/warudo-parity.md`: BP-01 (vector3 values, On Update), BP-05 (asset property set/get for transform, visibility, FOV), and BP-06 (held keys from any app on macOS; this pass-through path is not Different; registered hotkeys stay Different). Claim only verified behavior. Check that the spec matches what shipped (rulings in the ledger) and update it.

- [ ] **Step 8: Commit**

```bash
git add docs spdd
git commit -m "Record the continuous Blueprints check and parity"
```
