import { assetProperty, clampUser, DEFAULT_EASING, ease, eulerFromQuaternion, orbitFromTransform, orbitFromUser, orbitPivot, quaternionFromEuler, readProperty, shortYaw, transformFromOrbit, userFromOrbit, writeProperty, type Easing, type Id, type OrbitUser, type PropertyKey, type PropertyValue, type Quat, type Reply, type AppError, type SceneEntity, type SceneView, type Vec3 } from '@opensekai/contracts';
import { normalize, slerpQuat } from './bone-offsets';
import { evaluatedEntity, followOffset, overriddenEntity, touchedProperties, writeOverride, type OverrideLayer, type OverrideWrite } from './overrides';

export interface Transition { seconds: number; easing: Easing }
// One transition on the session clock. Every layer (properties, expressions, blend shapes, look-at) samples it the same way.
export interface Timing { startMs: number; seconds: number; easing: Easing }

export const transitionOf = (settings: { transitionSeconds?: number; easing?: Easing }): Transition | undefined =>
 settings.transitionSeconds === undefined ? undefined : { seconds: settings.transitionSeconds, easing: settings.easing ?? DEFAULT_EASING };
// The optional `transition` field of an effect, from the node settings.
export const withTransition = (settings: { transitionSeconds?: number; easing?: Easing }): { transition?: Transition } => {
 const transition = transitionOf(settings);
 return transition ? { transition } : {};
};
export const timing = (transition: Transition, startMs: number): Timing => ({ startMs, seconds: transition.seconds, easing: transition.easing });
// A transition starts at the time of the value that it starts from: the previous advance, at most 100 ms back.
// So a transition that a graph starts again on each tick still moves on that tick.
export const MAX_CATCH_UP_MS = 100;
export const transitionStart = (nowMs: number, sampledAtMs: number): number => Math.min(nowMs, Math.max(sampledAtMs, nowMs - MAX_CATCH_UP_MS));
export const running = (time: Timing | undefined, nowMs: number): boolean => time !== undefined && progress(time, nowMs) < 1;
export const progress = (time: Timing, nowMs: number): number =>
 time.seconds <= 0 ? 1 : Math.min(Math.max((nowMs - time.startMs) / (time.seconds * 1000), 0), 1);
export const eased = (time: Timing, nowMs: number): number => ease(time.easing, progress(time, nowMs));
export const lerp = (from: number, to: number, k: number): number => from + (to - from) * k;
export const unit = (value: number): number => Math.min(Math.max(value, 0), 1);

export type PropertyTweenValue =
 | { kind: 'number'; from: number; to: number }
 | { kind: 'vector3'; from: Vec3; to: Vec3 }
 // `target` is the Euler value as written, so the last write equals Set Asset Property without a transition.
 | { kind: 'rotation'; from: Quat; to: Quat; target: Vec3 };
// A Camera Orbit Character move (B32 R7): Yaw, Pitch, and Distance in user values; `to` has the short-way Yaw.
// `targetId` is the Focus Character at the start; a change of it (a removed character) stops the tween.
export interface OrbitTweenValue { kind: 'orbit'; from: OrbitUser; to: OrbitUser; targetId: Id | null }
export type TweenValue = PropertyTweenValue | OrbitTweenValue;
// The On Transition End output of a Set Asset Property node. `logic` is the logic key of its graph at the write; a changed graph does not run it.
export interface TransitionEnd { graphId: Id; nodeId: Id; logic: string }
// `ends` run when the tween reaches its end on the session clock, never when it stops for another reason.
export interface PropertyTween extends Timing { entityId: Id; property: PropertyKey; value: PropertyTweenValue; graphId: Id; ends: readonly TransitionEnd[] }
// One record for each camera, stored under both its `position` and `rotation` keys, so the busy check and the stop rules work by key.
export interface OrbitTween extends Timing { entityId: Id; property: 'position'; value: OrbitTweenValue; graphId: Id; ends: readonly TransitionEnd[] }
export type Tween = PropertyTween | OrbitTween;
export type TweenLayer = ReadonlyMap<string, Tween>;
// `pending` holds the ends of writes without a tween; they run on the next clock step.
export interface PropertyLayers { overrides: OverrideLayer; tweens: TweenLayer; pending?: readonly TransitionEnd[] }
export const MAX_TWEENS = 64, MIN_SCALE = 1e-4, MAX_TWEEN_ENDS = 8, MAX_PENDING_ENDS = 64;
export const EMPTY_TWEENS: TweenLayer = new Map();
const key = (entityId: Id, property: PropertyKey) => `${entityId}\0${property}`;
export const tweening = (layer: TweenLayer, entityId: Id, property: PropertyKey): boolean => layer.has(key(entityId, property));
const ORBIT_PROPERTIES: readonly PropertyKey[] = ['position', 'rotation'];
const isOrbit = (tween: Tween): tween is OrbitTween => tween.value.kind === 'orbit';
const propertiesOf = (tween: Tween): readonly PropertyKey[] => isOrbit(tween) ? ORBIT_PROPERTIES : [tween.property];
// Each tween once, also an orbit tween under two keys.
const records = (layer: TweenLayer): Tween[] => [...new Set(layer.values())];
export const tweenCount = (layer: TweenLayer): number => records(layer).length;

// An overshoot ease (Back, Elastic) must not write a value that the registry rejects.
function fit(property: PropertyKey, value: number): number {
 const { rule } = assetProperty(property);
 if (rule.kind === 'range') return Math.min(Math.max(value, rule.min), rule.max);
 return rule.kind === 'positive' ? Math.max(value, MIN_SCALE) : value;
}

export function sampleTween(tween: PropertyTween, nowMs: number): { value: PropertyValue; done: boolean } {
 const { value } = tween;
 if (progress(tween, nowMs) >= 1) return { value: value.kind === 'rotation' ? value.target : value.to, done: true };
 const k = eased(tween, nowMs);
 switch (value.kind) {
  case 'number': return { value: fit(tween.property, lerp(value.from, value.to, k)), done: false };
  case 'vector3': return { value: value.from.map((from, i) => fit(tween.property, lerp(from, value.to[i]!, k))) as Vec3, done: false };
  case 'rotation': return { value: eulerFromQuaternion(slerpQuat(value.from, value.to, k)), done: false };
 }
}

const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
type SetProperty = Extract<OverrideWrite, { kind: 'setProperty' }>;
const sameValue = (a: readonly number[] | number, b: readonly number[] | number) => JSON.stringify(a) === JSON.stringify(b);
const targetOf = (value: PropertyTweenValue) => (value.kind === 'rotation' ? value.target : value.to);
const sameEnd = (a: TransitionEnd, b: TransitionEnd) => a.graphId === b.graphId && a.nodeId === b.nodeId;
// A running tween to the same target keeps running, and `end` joins it. A target equal to the current value starts nothing.
export function startTween(layer: TweenLayer, scene: SceneView, overrides: OverrideLayer, write: SetProperty, transition: Transition, graphId: Id, startMs: number, end?: TransitionEnd): Reply<TweenLayer> {
 const entity = overriddenEntity(scene, overrides, write.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [write.entityId] } };
 const checked = writeProperty(entity, write.property, write.value);
 if (!checked.ok) return checked;
 const id = key(write.entityId, write.property), found = layer.get(id);
 // A property tween on the Position or Rotation of a camera stops its orbit tween.
 if (found && isOrbit(found)) layer = without(layer, [id]);
 const active = found && !isOrbit(found) ? found : undefined;
 if (active && sameValue(targetOf(active.value), write.value as Vec3 | number)) {
  if (!end || active.ends.some(item => sameEnd(item, end))) return { ok: true, data: layer };
  if (active.ends.length >= MAX_TWEEN_ENDS) return fail('Transition limit reached', [write.entityId]);
  return { ok: true, data: new Map(layer).set(id, { ...active, ends: [...active.ends, end] }) };
 }
 if (!active && JSON.stringify(checked.data) === JSON.stringify(entity)) return { ok: true, data: layer };
 if (!active && tweenCount(layer) >= MAX_TWEENS) return fail('Transition limit reached', [write.entityId]);
 const current = readProperty(entity, write.property)!;
 const value: PropertyTweenValue = write.property === 'rotation'
  ? { kind: 'rotation', from: normalize(entity.transform.rotation as Quat), to: quaternionFromEuler(write.value as Vec3), target: [...write.value as Vec3] }
  : typeof current === 'number' ? { kind: 'number', from: current, to: write.value as number }
  : { kind: 'vector3', from: current as Vec3, to: [...write.value as Vec3] };
 return { ok: true, data: new Map(layer).set(id, { entityId: write.entityId, property: write.property, value, graphId, ends: end ? [end] : [], ...timing(transition, startMs) }) };
}

// Removing one key of an orbit tween removes the tween.
const without = (layer: TweenLayer, ids: readonly string[]): TweenLayer => {
 if (!ids.some(id => layer.has(id))) return layer;
 const next = new Map(layer);
 for (const id of ids) {
  const tween = layer.get(id);
  for (const item of tween ? propertiesOf(tween).map(property => key(tween.entityId, property)) : [id]) next.delete(item);
 }
 return next;
};

// The end of a write: on the tween that the write started or joined, else pending for the next clock step.
const withPending = (layers: PropertyLayers, end: TransitionEnd | undefined): Reply<PropertyLayers> => {
 if (!end) return { ok: true, data: layers };
 const pending = layers.pending ?? [];
 if (pending.length >= MAX_PENDING_ENDS) return fail('Transition limit reached', [end.nodeId]);
 return { ok: true, data: { ...layers, pending: [...pending, end] } };
};
// Set Asset Property with a transition starts a tween. Each other write goes to the override layer and stops the tween of its property.
export function writeTransitioned(layers: PropertyLayers, scene: SceneView, write: OverrideWrite, graphId: Id, nowMs: number, startMs = nowMs, end?: TransitionEnd): Reply<PropertyLayers> {
 if (write.kind === 'setProperty' && write.transition && write.transition.seconds > 0 && assetProperty(write.property).type !== 'boolean') {
  const started = startTween(layers.tweens, scene, layers.overrides, write, write.transition, graphId, startMs, end);
  if (!started.ok) return started;
  const next = { ...layers, tweens: started.data };
  return started.data.has(key(write.entityId, write.property)) ? { ok: true, data: next } : withPending(next, end);
 }
 const written = writeOverride(layers.overrides, scene, write, graphId, nowMs);
 if (!written.ok) return written;
 const property = write.kind === 'setProperty' ? write.property : 'position';
 return withPending({ ...layers, overrides: written.data, tweens: without(layers.tweens, [key(write.entityId, property)]) }, end);
}

// Writes the sample of each tween to the override layer at the session time. A tween that cannot write stops and reports its graph.
// `ended` lists the ends of the tweens that reached their end, in tween order.
export function advanceTweens(layers: PropertyLayers, scene: SceneView, nowMs: number): { layers: PropertyLayers; failures: { graphId: Id; error: AppError }[]; ended: TransitionEnd[] } {
 if (layers.tweens.size === 0) return { layers, failures: [], ended: [] };
 let overrides = layers.overrides, tweens = layers.tweens;
 const failures: { graphId: Id; error: AppError }[] = [], ended: TransitionEnd[] = [];
 for (const tween of records(layers.tweens)) {
  const id = key(tween.entityId, tween.property);
  let written: Reply<OverrideLayer>, done: boolean;
  if (isOrbit(tween)) {
   const camera = scene.entities.find(item => item.id === tween.entityId);
   if (camera?.kind === 'camera' && camera.navigation?.mode === 'orbitCharacter' && camera.navigation.targetId !== tween.value.targetId) { tweens = without(tweens, [id]); continue; }
   done = progress(tween, nowMs) >= 1;
   written = writeOrbitPose(overrides, scene, tween.entityId, done ? tween.value.to : easedOrbit(tween, nowMs), tween.graphId, nowMs);
  } else {
   const sample = sampleTween(tween, nowMs);
   done = sample.done;
   written = writeOverride(overrides, scene, { kind: 'setProperty', entityId: tween.entityId, property: tween.property, value: sample.value }, tween.graphId, nowMs);
  }
  if (!written.ok) { failures.push({ graphId: tween.graphId, error: written.error }); tweens = without(tweens, [id]); continue; }
  overrides = written.data;
  if (done) { tweens = without(tweens, [id]); ended.push(...tween.ends); }
 }
 return { layers: { ...layers, overrides, tweens }, failures, ended };
}

// A patch that changes a property (or removes the entity) stops its tween, as it drops the override.
export function dropTweens(layer: TweenLayer, operations: Parameters<typeof touchedProperties>[0][]): TweenLayer {
 if (layer.size === 0) return layer;
 const ids: string[] = [];
 for (const operation of operations) {
  const hit = touchedProperties(operation);
  if (!hit) continue;
  const [entityId, keys] = hit;
  for (const tween of layer.values()) if (tween.entityId === entityId && (keys === 'all' || propertiesOf(tween).some(property => keys.includes(property)))) ids.push(key(entityId, tween.property));
 }
 return without(layer, ids);
}

// The graphs that own a tween or one of its ends, and the layer without the tweens and the ends of the given graphs.
export const tweenOwners = (layer: TweenLayer): Id[] => records(layer).flatMap(tween => [tween.graphId, ...tween.ends.map(end => end.graphId)]);
export function dropGraphTweens(layer: TweenLayer, graphIds: ReadonlySet<Id>): TweenLayer {
 const kept = without(layer, [...layer].filter(([, tween]) => graphIds.has(tween.graphId)).map(([id]) => id));
 if (![...kept.values()].some(tween => tween.ends.some(end => graphIds.has(end.graphId)))) return kept;
 // One new record for each tween, so both keys of an orbit tween keep one record.
 const trimmed = new Map(records(kept).map(tween => [tween, { ...tween, ends: tween.ends.filter(end => !graphIds.has(end.graphId)) } as Tween]));
 return new Map([...kept].map(([id, tween]) => [id, trimmed.get(tween)!]));
}

// Camera Orbit Character (B32). The node works in persistent coordinates: the pivot is the persistent root of the Focus
// Character plus `pivotOffset`, and the position override is follow-relative, so the follow offset of a character that a
// Blueprint moves goes on top when the frame is evaluated (R4).
export interface OrbitWrite { kind: 'orbitCamera'; cameraId: Id; target: OrbitUser; transition?: Transition; nodeId?: Id }
type OrbitCamera = Extract<SceneEntity, { kind: 'camera' }>;
function orbitCamera(scene: SceneView, cameraId: Id): Reply<{ camera: OrbitCamera; pivot: Vec3 }> {
 const camera = scene.entities.find(item => item.id === cameraId);
 if (!camera) return { ok: false, error: { code: 'NOT_FOUND', message: 'Camera not found', ids: [cameraId] } };
 if (camera.kind !== 'camera') return fail('Entity is not a camera', [cameraId]);
 const navigation = camera.navigation;
 if (navigation?.mode !== 'orbitCharacter') return fail('Camera is not in Orbit Character mode', [cameraId]);
 const target = navigation.targetId ? scene.entities.find(item => item.id === navigation.targetId) : undefined;
 return { ok: true, data: { camera, pivot: orbitPivot(target?.transform.position ?? null, navigation.pivotOffset) } };
}
const easedOrbit = (tween: OrbitTween, nowMs: number): OrbitUser => {
 const k = eased(tween, nowMs), { from, to } = tween.value;
 return { yawDegrees: lerp(from.yawDegrees, to.yawDegrees, k), pitchDegrees: lerp(from.pitchDegrees, to.pitchDegrees, k), distance: lerp(from.distance, to.distance, k) };
};
// Writes the camera position (follow-relative) and rotation (Euler degrees, as the layer stores it) for `user` around the current pivot.
function writeOrbitPose(overrides: OverrideLayer, scene: SceneView, cameraId: Id, user: OrbitUser, graphId: Id, nowMs: number): Reply<OverrideLayer> {
 const found = orbitCamera(scene, cameraId);
 if (!found.ok) return found;
 const transform = transformFromOrbit(orbitFromUser(user, found.data.pivot), found.data.camera.transform.scale);
 const placed = writeOverride(overrides, scene, { kind: 'setProperty', entityId: cameraId, property: 'position', value: transform.position }, graphId, nowMs, true);
 if (!placed.ok) return placed;
 return writeOverride(placed.data, scene, { kind: 'setProperty', entityId: cameraId, property: 'rotation', value: eulerFromQuaternion(transform.rotation) }, graphId, nowMs);
}
const ANGLE_EPSILON = 1e-6;
const sameOrbit = (a: OrbitUser, b: OrbitUser) => {
 const yaw = ((a.yawDegrees - b.yawDegrees) % 360 + 360) % 360;
 return Math.min(yaw, 360 - yaw) < ANGLE_EPSILON && Math.abs(a.pitchDegrees - b.pitchDegrees) < ANGLE_EPSILON && Math.abs(a.distance - b.distance) < ANGLE_EPSILON;
};
// The current orbit of the camera in persistent coordinates: the evaluated position minus the follow offset.
function currentOrbit(scene: SceneView, overrides: OverrideLayer, cameraId: Id, pivot: Vec3, targetId: Id | null): OrbitUser {
 const evaluated = evaluatedEntity(scene, overrides, cameraId)!;
 const offset = followOffset(scene, overrides, targetId) ?? [0, 0, 0];
 const position = evaluated.transform.position.map((value, i) => value - offset[i]!) as Vec3;
 return userFromOrbit(orbitFromTransform({ ...evaluated.transform, position }, pivot));
}
// Camera Orbit Character: an immediate write, or an orbit tween that owns the camera Position and Rotation (R5–R7).
export function writeOrbit(layers: PropertyLayers, scene: SceneView, write: OrbitWrite, graphId: Id, nowMs: number, startMs = nowMs, end?: TransitionEnd): Reply<PropertyLayers> {
 if (![write.target.yawDegrees, write.target.pitchDegrees, write.target.distance].every(Number.isFinite)) return fail('Orbit values must be finite', [write.cameraId]);
 const found = orbitCamera(scene, write.cameraId);
 if (!found.ok) return found;
 const { camera, pivot } = found.data;
 const from = currentOrbit(scene, layers.overrides, camera.id, pivot, camera.navigation?.mode === 'orbitCharacter' ? camera.navigation.targetId : null);
 const target = clampUser(write.target), to = { ...target, yawDegrees: shortYaw(from.yawDegrees, target.yawDegrees) };
 const id = key(camera.id, 'position'), active = layers.tweens.get(id);
 if (write.transition && write.transition.seconds > 0) {
  if (active && isOrbit(active) && sameOrbit(active.value.to, to)) {
   if (!end || active.ends.some(item => sameEnd(item, end))) return { ok: true, data: layers };
   if (active.ends.length >= MAX_TWEEN_ENDS) return fail('Transition limit reached', [camera.id]);
   const joined: OrbitTween = { ...active, ends: [...active.ends, end] };
   return { ok: true, data: { ...layers, tweens: new Map(layers.tweens).set(id, joined).set(key(camera.id, 'rotation'), joined) } };
  }
  const rest = without(layers.tweens, [id, key(camera.id, 'rotation')]);
  if (sameOrbit(from, to)) return withPending({ ...layers, tweens: rest }, end);
  if (tweenCount(rest) >= MAX_TWEENS) return fail('Transition limit reached', [camera.id]);
  const targetId = camera.navigation?.mode === 'orbitCharacter' ? camera.navigation.targetId : null;
  const tween: OrbitTween = { entityId: camera.id, property: 'position', value: { kind: 'orbit', from, to, targetId }, graphId, ends: end ? [end] : [], ...timing(write.transition, startMs) };
  return { ok: true, data: { ...layers, tweens: new Map(rest).set(id, tween).set(key(camera.id, 'rotation'), tween) } };
 }
 const tweens = without(layers.tweens, [id, key(camera.id, 'rotation')]);
 if (sameOrbit(from, to)) return withPending({ ...layers, tweens }, end);
 const written = writeOrbitPose(layers.overrides, scene, camera.id, to, graphId, nowMs);
 if (!written.ok) return written;
 return withPending({ ...layers, overrides: written.data, tweens }, end);
}
