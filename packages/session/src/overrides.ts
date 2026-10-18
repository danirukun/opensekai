import { rotateByQuaternion, writeProperty, type Id, type PropertyKey, type PropertyValue, type Reply, type SceneEntity, type ScenePatch, type SceneView, type Vec3 } from '@opensekai/contracts';
import { delta, shifted } from './camera-follow';

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
 layer.size === 0 ? scene : { ...scene, entities: scene.entities.map(entity => followed(scene, layer, layer.has(entity.id) ? overriddenEntity(scene, layer, entity.id)! : entity)) };
// An Orbit Character camera follows the position override of its target (R6a): it moves by the override's offset from the
// persistent target. The idle commit moves the persistent camera by the same offset, so the evaluated camera does not jump.
function followed(scene: SceneView, layer: OverrideLayer, entity: SceneEntity): SceneEntity {
 if (entity.kind !== 'camera' || entity.navigation?.mode !== 'orbitCharacter' || layer.get(entity.id)?.has('position')) return entity;
 const targetId = entity.navigation.targetId;
 const override = targetId ? layer.get(targetId)?.get('position') : undefined;
 const target = override && scene.entities.find(item => item.id === targetId);
 if (!override || !target) return entity;
 return { ...entity, transform: { ...entity.transform, position: shifted(entity.transform.position, delta(target.transform.position, override.value as Vec3)) } };
}

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
 // A write that does not change the value keeps the last write time, so On Update graphs can stop.
 if (JSON.stringify(checked.data) === JSON.stringify(entity)) return { ok: true, data: layer };
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
  if (idle.has('intensity') && target.kind === 'light') operations.push({ kind: 'setLight', entityId, light: structuredClone(target.light) });
  if (idle.has('renderEnvironment') && target.kind === 'camera') operations.push({ kind: 'setCameraRenderEnvironment', entityId, renderEnvironment: target.renderEnvironment !== false });
 }
 return { operations, graphIds: [...graphIds], remaining };
}

const touched = (operation: Operation): [Id, readonly PropertyKey[] | 'all'] | null => {
 switch (operation.kind) {
  case 'setTransform': return [operation.entityId, ['position', 'rotation', 'scale']];
  case 'setVisibility': return [operation.entityId, ['visible']];
  case 'setCameraLens': return [operation.entityId, ['fovDegrees']];
  case 'setCameraRenderEnvironment': return [operation.entityId, ['renderEnvironment']];
  case 'setLight': return [operation.entityId, ['intensity']];
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
