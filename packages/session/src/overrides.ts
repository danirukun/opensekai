import { avatarLighting, materialParameter, MATERIAL_PARAMETER_KEYS, MAX_MATERIALS, rotateByQuaternion, savedMaterialValue, withMaterialValue, writeProperty, type AssetRecord, type Id, type MaterialParameter, type PropertyKey, type PropertyValue, type Reply, type SceneEntity, type ScenePatch, type SceneView, type Vec3 } from '@opensekai/contracts';
import { delta, followers, shifted } from './camera-follow';
import type { Transition } from './tweens';

// A material key (B38 R25) names one parameter of one material. The parameter is first, so the name can hold any character.
export type MaterialKey = `material:${MaterialParameter}:${string}`;
export type OverrideKey = PropertyKey | MaterialKey;
export const materialKey = (parameter: MaterialParameter, name: string): MaterialKey => `material:${parameter}:${name}`;
export const isMaterialKey = (key: OverrideKey): key is MaterialKey => key.startsWith('material:');
export function parseMaterialKey(key: OverrideKey): { parameter: MaterialParameter; name: string } | null {
 if (!isMaterialKey(key)) return null;
 const rest = key.slice('material:'.length), split = rest.indexOf(':');
 const parameter = rest.slice(0, split) as MaterialParameter;
 return split > 0 && MATERIAL_PARAMETER_KEYS.includes(parameter) ? { parameter, name: rest.slice(split + 1) } : null;
}
// A material value. Null is a Reset marker: it removes the saved parameter.
export type MaterialWriteValue = string | number | null;
export type OverrideValue = PropertyValue | MaterialWriteValue;
// `followRelative` marks a camera position in persistent coordinates (Camera Orbit Character, B32 R4): the follow offset of
// its Orbit Character target goes on top of it, as for a camera without a position override.
export interface OverrideEntry { value: OverrideValue; lastWriteMs: number; graphIds: readonly Id[]; followRelative?: true }
export type OverrideLayer = ReadonlyMap<Id, ReadonlyMap<OverrideKey, OverrideEntry>>;
// A Set or Reset Material Property write (R25). `target` is the entity kind of the node. `resolveMaterialWrite` adds
// `model`, the record value of the parameter, which a transition starts from when the entity has no saved value.
export interface MaterialWrite { kind: 'setMaterial'; entityId: Id; target: 'avatar' | 'mesh'; material: string; parameter: MaterialParameter; value: MaterialWriteValue; transition?: Transition; nodeId?: Id; model?: string | number }
export type OverrideWrite =
 // `nodeId` is the Set Asset Property node of the write; its On Transition End runs after the write.
 | { kind: 'setProperty'; entityId: Id; property: PropertyKey; value: PropertyValue; transition?: Transition; nodeId?: Id }
 | { kind: 'moveEntity'; entityId: Id; space: 'world' | 'local'; delta: Vec3 }
 | MaterialWrite;
type Operation = ScenePatch['operations'][number];
export const MAX_OVERRIDES = 256, COMMIT_IDLE_MS = 250;
export const EMPTY_OVERRIDES: OverrideLayer = new Map();

const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const size = (layer: OverrideLayer) => [...layer.values()].reduce((n, entries) => n + entries.size, 0);

// The entity with one override value. A material value goes into the saved group of the entity.
function writeKey(entity: SceneEntity, key: OverrideKey, value: OverrideValue): Reply<SceneEntity> {
 const material = parseMaterialKey(key);
 if (!material) return writeProperty(entity, key as PropertyKey, value as PropertyValue);
 if (entity.kind !== 'avatar' && entity.kind !== 'mesh') return fail('Entity has no materials', [entity.id]);
 const materials = withMaterialValue(entity.materials, material.name, material.parameter, value as MaterialWriteValue);
 // The group keeps saved values of names that the model does not have (R30), so a new name can pass the limit.
 if (Object.keys(materials).length > MAX_MATERIALS) return fail('Too many materials', [entity.id]);
 if (Object.keys(materials).length) return { ok: true, data: { ...entity, materials } };
 const { materials: _old, ...rest } = entity;
 return { ok: true, data: rest };
}
/** The saved value of a material key on an entity, or undefined. */
export function savedValueOf(entity: SceneEntity, key: MaterialKey): string | number | undefined {
 const material = parseMaterialKey(key);
 return material && (entity.kind === 'avatar' || entity.kind === 'mesh') ? savedMaterialValue(entity.materials, material.name, material.parameter) : undefined;
}

// R24: check a Set or Reset Material Property write against the record materials. A number is clamped, and `model` is added.
export function resolveMaterialWrite(scene: SceneView, write: MaterialWrite, record: (assetId: Id) => AssetRecord | undefined): Reply<MaterialWrite> {
 const entity = scene.entities.find(item => item.id === write.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [write.entityId] } };
 if (entity.kind !== write.target) return fail(write.target === 'avatar' ? 'Entity is not an avatar' : 'Entity is not a prop', [entity.id]);
 const assetId = entity.kind === 'avatar' ? entity.assetId : entity.kind === 'mesh' && entity.source.kind === 'asset' ? entity.source.assetId : null;
 const found = assetId === null ? undefined : record(assetId)?.materials?.find(item => item.name === write.material);
 if (!found) return fail('Material not found', [entity.id]);
 const spec = materialParameter(write.parameter);
 if (!spec.applies(found)) return fail('Material property does not apply', [entity.id]);
 let value = write.value;
 if (spec.type === 'number' && value !== null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Invalid material value', [entity.id]);
  value = Math.min(Math.max(value, spec.range[0]), spec.range[1]);
 }
 if (spec.type === 'color' && value !== null && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/.test(value))) return fail('Invalid material value', [entity.id]);
 return { ok: true, data: { ...write, value, model: found.model[write.parameter] ?? spec.defaultValue } };
}

export function overriddenEntity(scene: SceneView, layer: OverrideLayer, entityId: Id): SceneEntity | null {
 let entity = scene.entities.find(item => item.id === entityId);
 if (!entity) return null;
 for (const [key, entry] of layer.get(entityId) ?? []) {
  const next = writeKey(entity, key, entry.value);
  if (next.ok) entity = next.data;
 }
 return entity;
}
// One entity of the evaluated scene, without evaluating the others.
export function evaluatedEntity(scene: SceneView, layer: OverrideLayer, entityId: Id): SceneEntity | undefined {
 const entity = layer.has(entityId) ? overriddenEntity(scene, layer, entityId) : scene.entities.find(item => item.id === entityId);
 return entity ? followed(scene, layer, entity) : undefined;
}
export const applyOverrides = (scene: SceneView, layer: OverrideLayer): SceneView =>
 layer.size === 0 ? scene : { ...scene, entities: scene.entities.map(entity => followed(scene, layer, layer.has(entity.id) ? overriddenEntity(scene, layer, entity.id)! : entity)) };
// An Orbit Character camera follows the position override of its target (R6a): it moves by the override's offset from the
// persistent target. The idle commit moves the persistent camera by the same offset, so the evaluated camera does not jump.
// A camera position override skips the follow, unless it is follow-relative.
function followed(scene: SceneView, layer: OverrideLayer, entity: SceneEntity): SceneEntity {
 const own = layer.get(entity.id)?.get('position');
 if (entity.kind !== 'camera' || entity.navigation?.mode !== 'orbitCharacter' || (own && !own.followRelative)) return entity;
 const offset = followOffset(scene, layer, entity.navigation.targetId);
 return offset ? { ...entity, transform: { ...entity.transform, position: shifted(entity.transform.position, offset) } } : entity;
}
// The position override of a character minus its persistent position, or null when it has no position override.
export function followOffset(scene: SceneView, layer: OverrideLayer, targetId: Id | null): Vec3 | null {
 const override = targetId ? layer.get(targetId)?.get('position') : undefined;
 const target = override && scene.entities.find(item => item.id === targetId);
 return override && target ? delta(target.transform.position, override.value as Vec3) : null;
}

export function writeOverride(layer: OverrideLayer, scene: SceneView, write: OverrideWrite, graphId: Id, nowMs: number, relative = false): Reply<OverrideLayer> {
 const entity = overriddenEntity(scene, layer, write.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [write.entityId] } };
 let property: OverrideKey, value: OverrideValue;
 if (write.kind === 'setProperty') ({ property, value } = write);
 else if (write.kind === 'setMaterial') { property = materialKey(write.parameter, write.material); value = write.value; }
 else {
  if (entity.kind === 'tracking') return fail('Property does not apply to this entity', [entity.id]);
  const delta = write.space === 'local' ? rotateByQuaternion(write.delta, entity.transform.rotation) : write.delta;
  const [x, y, z] = entity.transform.position;
  property = 'position';
  value = [x + delta[0], y + delta[1], z + delta[2]];
 }
 const checked = writeKey(entity, property, value);
 if (!checked.ok) return checked;
 // R25: a Set that keeps the evaluated value (the saved value, else the model value) writes nothing, so it makes no commit.
 // A Reset always removes a saved key, also one equal to the model value, so a value that does not show cannot stay saved.
 if (write.kind === 'setMaterial' && write.model !== undefined && write.value !== null && write.value === (savedValueOf(entity, property as MaterialKey) ?? write.model)) return { ok: true, data: layer };
 // A write that does not change the value keeps the last write time, so On Update graphs can stop.
 const own = layer.get(write.entityId), previous = own?.get(property);
 // A Move Entity delta keeps the coordinates of the position that it moves, so a follow-relative position stays follow-relative.
 const followRelative = relative || (write.kind === 'moveEntity' && previous?.followRelative === true);
 if (JSON.stringify(checked.data) === JSON.stringify(entity) && Boolean(previous?.followRelative) === followRelative) return { ok: true, data: layer };
 if (!previous && size(layer) >= MAX_OVERRIDES) return fail('Override limit reached', [write.entityId]);
 const graphIds = previous?.graphIds.includes(graphId) ? previous.graphIds : [...(previous?.graphIds ?? []), graphId];
 const next = new Map(layer);
 next.set(write.entityId, new Map(own).set(property, { value: structuredClone(value), lastWriteMs: nowMs, graphIds, ...(followRelative ? { followRelative: true as const } : {}) }));
 return { ok: true, data: next };
}

// `busy` keeps an override from committing, for example while a transition writes it.
// `force` also takes an override before its 250 ms, for example the writes of a manual run (Editor and MCP fixes R4). A busy override stays.
export function takeIdle(scene: SceneView, layer: OverrideLayer, nowMs: number, busy: (entityId: Id, property: OverrideKey) => boolean = () => false, force: (entityId: Id, property: OverrideKey) => boolean = () => false): { operations: Operation[]; graphIds: Id[]; remaining: OverrideLayer } {
 const operations: Operation[] = [], graphIds = new Set<Id>(), remaining = new Map<Id, ReadonlyMap<OverrideKey, OverrideEntry>>();
 const idleOf = new Map([...layer].map(([entityId, entries]) => [entityId, new Map([...entries].filter(([key, entry]) => (nowMs - entry.lastWriteMs >= COMMIT_IDLE_MS || force(entityId, key)) && !busy(entityId, key)))]));
 // A character position that commits moves the persistent character, so a follow-relative camera position moves with it.
 const moved = new Map<Id, Vec3>();
 for (const [entityId, idle] of idleOf) {
  const offset = idle.has('position') ? followOffset(scene, layer, entityId) : null;
  if (offset) for (const cameraId of followers(scene, entityId)) moved.set(cameraId, offset);
 }
 for (const [entityId, own] of layer) {
  const offset = moved.get(entityId), position = own.get('position');
  const entries = offset && position?.followRelative ? new Map(own).set('position', { ...position, value: shifted(position.value as Vec3, offset) }) : own;
  const idle = new Map([...idleOf.get(entityId)!.keys()].map(key => [key, entries.get(key)!]));
  const pending = new Map([...entries].filter(([key]) => !idle.has(key)));
  if (pending.size) remaining.set(entityId, pending);
  if (!idle.size) continue;
  for (const entry of idle.values()) for (const id of entry.graphIds) graphIds.add(id);
  const target = overriddenEntity(scene, new Map([[entityId, idle]]), entityId);
  if (!target) continue;
  if (idle.has('position') || idle.has('rotation') || idle.has('scale')) operations.push({ kind: 'setTransform', entityId, transform: structuredClone(target.transform) });
  if (idle.has('visible')) operations.push({ kind: 'setVisibility', entityId, visible: target.visible });
  if (idle.has('fovDegrees') && target.kind === 'camera') operations.push({ kind: 'setCameraLens', entityId, lens: structuredClone(target.lens) });
  if (idle.has('intensity') && target.kind === 'light') operations.push({ kind: 'setLight', entityId, light: structuredClone(target.light) });
  if (idle.has('hazeDensity') && target.kind === 'haze') operations.push({ kind: 'setHaze', entityId, haze: structuredClone(target.haze) });
  if (idle.has('rimStrength') && target.kind === 'avatar') operations.push({ kind: 'setAvatarLighting', entityId, lighting: structuredClone(avatarLighting(target)) });
  if (idle.has('renderEnvironment') && target.kind === 'camera') operations.push({ kind: 'setCameraRenderEnvironment', entityId, renderEnvironment: target.renderEnvironment !== false });
  // The idle material keys of an entity commit as one group (R25).
  if ([...idle.keys()].some(isMaterialKey) && (target.kind === 'avatar' || target.kind === 'mesh')) operations.push({ kind: 'setMaterialValues', entityId, materials: structuredClone(target.materials ?? {}) });
 }
 return { operations, graphIds: [...graphIds], remaining };
}

// `materials` is each material key of the entity (R27).
export type TouchedKeys = readonly PropertyKey[] | 'all' | 'materials';
export const touchedProperties = (operation: Operation): [Id, TouchedKeys] | null => {
 switch (operation.kind) {
  case 'setTransform': return [operation.entityId, ['position', 'rotation', 'scale']];
  case 'setVisibility': return [operation.entityId, ['visible']];
  case 'setCameraLens': return [operation.entityId, ['fovDegrees']];
  case 'setCameraRenderEnvironment': return [operation.entityId, ['renderEnvironment']];
  case 'setLight': return [operation.entityId, ['intensity']];
  case 'setHaze': return [operation.entityId, ['hazeDensity']];
  case 'setAvatarLighting': return [operation.entityId, ['rimStrength']];
  // A Control Mode, Focus Character, or pivot change ends a Blueprint orbit of the camera (B32 R7).
  case 'setCameraNavigation': return [operation.entityId, ['position', 'rotation']];
  case 'removeEntity': return [operation.entityId, 'all'];
  case 'setMaterialValues': case 'setAvatarModel': case 'setMeshModel': return [operation.entityId, 'materials'];
  default: return null;
 }
};
export const touches = (keys: TouchedKeys, key: OverrideKey): boolean =>
 keys === 'all' || (keys === 'materials' ? isMaterialKey(key) : (keys as readonly OverrideKey[]).includes(key));
export function dropOverrides(layer: OverrideLayer, operations: readonly Operation[]): OverrideLayer {
 let next: Map<Id, ReadonlyMap<OverrideKey, OverrideEntry>> | null = null;
 for (const operation of operations) {
  const hit = touchedProperties(operation);
  if (!hit || !(next ?? layer).has(hit[0])) continue;
  next ??= new Map(layer);
  const [id, keys] = hit;
  const kept = new Map([...next.get(id)!].filter(([key]) => !touches(keys, key)));
  if (kept.size) next.set(id, kept); else next.delete(id);
 }
 return next ?? layer;
}
