import { assetProperty, DEFAULT_EASING, ease, eulerFromQuaternion, quaternionFromEuler, readProperty, writeProperty, type Easing, type Id, type PropertyKey, type PropertyValue, type Quat, type Reply, type AppError, type SceneView, type Vec3 } from '@opensekai/contracts';
import { slerpQuat } from './bone-offsets';
import { overriddenEntity, touchedProperties, writeOverride, type OverrideLayer, type OverrideWrite } from './overrides';

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
export const timing = (transition: Transition, nowMs: number): Timing => ({ startMs: nowMs, seconds: transition.seconds, easing: transition.easing });
export const progress = (time: Timing, nowMs: number): number =>
 time.seconds <= 0 ? 1 : Math.min(Math.max((nowMs - time.startMs) / (time.seconds * 1000), 0), 1);
export const eased = (time: Timing, nowMs: number): number => ease(time.easing, progress(time, nowMs));
export const lerp = (from: number, to: number, k: number): number => from + (to - from) * k;
export const unit = (value: number): number => Math.min(Math.max(value, 0), 1);

export type TweenValue =
 | { kind: 'number'; from: number; to: number }
 | { kind: 'vector3'; from: Vec3; to: Vec3 }
 // `target` is the Euler value as written, so the last write equals Set Asset Property without a transition.
 | { kind: 'rotation'; from: Quat; to: Quat; target: Vec3 };
export interface PropertyTween extends Timing { entityId: Id; property: PropertyKey; value: TweenValue; graphId: Id }
export type TweenLayer = ReadonlyMap<string, PropertyTween>;
export interface PropertyLayers { overrides: OverrideLayer; tweens: TweenLayer }
export const MAX_TWEENS = 64, MIN_SCALE = 1e-4;
export const EMPTY_TWEENS: TweenLayer = new Map();
const key = (entityId: Id, property: PropertyKey) => `${entityId}\0${property}`;
export const tweening = (layer: TweenLayer, entityId: Id, property: PropertyKey): boolean => layer.has(key(entityId, property));

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

const normalized = (q: Quat): Quat => { const length = Math.hypot(...q); return length > 0 ? q.map(n => n / length) as Quat : [0, 0, 0, 1]; };
const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
type SetProperty = Extract<OverrideWrite, { kind: 'setProperty' }>;
export function startTween(layer: TweenLayer, scene: SceneView, overrides: OverrideLayer, write: SetProperty, transition: Transition, graphId: Id, nowMs: number): Reply<TweenLayer> {
 const entity = overriddenEntity(scene, overrides, write.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [write.entityId] } };
 const checked = writeProperty(entity, write.property, write.value);
 if (!checked.ok) return checked;
 const id = key(write.entityId, write.property);
 if (!layer.has(id) && layer.size >= MAX_TWEENS) return fail('Transition limit reached', [write.entityId]);
 const current = readProperty(entity, write.property)!;
 const value: TweenValue = write.property === 'rotation'
  ? { kind: 'rotation', from: normalized(entity.transform.rotation as Quat), to: quaternionFromEuler(write.value as Vec3), target: [...write.value as Vec3] }
  : typeof current === 'number' ? { kind: 'number', from: current, to: write.value as number }
  : { kind: 'vector3', from: current as Vec3, to: [...write.value as Vec3] };
 return { ok: true, data: new Map(layer).set(id, { entityId: write.entityId, property: write.property, value, graphId, ...timing(transition, nowMs) }) };
}

const without = (layer: TweenLayer, ids: readonly string[]): TweenLayer => {
 if (!ids.some(id => layer.has(id))) return layer;
 const next = new Map(layer);
 for (const id of ids) next.delete(id);
 return next;
};

// Set Asset Property with a transition starts a tween. Each other write goes to the override layer and stops the tween of its property.
export function writeTransitioned(layers: PropertyLayers, scene: SceneView, write: OverrideWrite, graphId: Id, nowMs: number): Reply<PropertyLayers> {
 if (write.kind === 'setProperty' && write.transition && write.transition.seconds > 0 && assetProperty(write.property).type !== 'boolean') {
  const started = startTween(layers.tweens, scene, layers.overrides, write, write.transition, graphId, nowMs);
  return started.ok ? { ok: true, data: { ...layers, tweens: started.data } } : started;
 }
 const written = writeOverride(layers.overrides, scene, write, graphId, nowMs);
 if (!written.ok) return written;
 const property = write.kind === 'setProperty' ? write.property : 'position';
 return { ok: true, data: { overrides: written.data, tweens: without(layers.tweens, [key(write.entityId, property)]) } };
}

// Writes the sample of each tween to the override layer at the session time. A tween that cannot write stops and reports its graph.
export function advanceTweens(layers: PropertyLayers, scene: SceneView, nowMs: number): { layers: PropertyLayers; failures: { graphId: Id; error: AppError }[] } {
 if (layers.tweens.size === 0) return { layers, failures: [] };
 let overrides = layers.overrides;
 const tweens = new Map(layers.tweens), failures: { graphId: Id; error: AppError }[] = [];
 for (const [id, tween] of layers.tweens) {
  const { value, done } = sampleTween(tween, nowMs);
  const written = writeOverride(overrides, scene, { kind: 'setProperty', entityId: tween.entityId, property: tween.property, value }, tween.graphId, nowMs);
  if (!written.ok) { failures.push({ graphId: tween.graphId, error: written.error }); tweens.delete(id); continue; }
  overrides = written.data;
  if (done) tweens.delete(id);
 }
 return { layers: { overrides, tweens }, failures };
}

// A patch that changes a property (or removes the entity) stops its tween, as it drops the override.
export function dropTweens(layer: TweenLayer, operations: Parameters<typeof touchedProperties>[0][]): TweenLayer {
 if (layer.size === 0) return layer;
 const ids: string[] = [];
 for (const operation of operations) {
  const hit = touchedProperties(operation);
  if (!hit) continue;
  const [entityId, keys] = hit;
  for (const tween of layer.values()) if (tween.entityId === entityId && (keys === 'all' || keys.includes(tween.property))) ids.push(key(entityId, tween.property));
 }
 return without(layer, ids);
}
