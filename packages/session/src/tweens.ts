import { assetProperty, DEFAULT_EASING, ease, eulerFromQuaternion, quaternionFromEuler, readProperty, writeProperty, type Easing, type Id, type PropertyKey, type PropertyValue, type Quat, type Reply, type AppError, type SceneView, type Vec3 } from '@opensekai/contracts';
import { normalize, slerpQuat } from './bone-offsets';
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

export type TweenValue =
 | { kind: 'number'; from: number; to: number }
 | { kind: 'vector3'; from: Vec3; to: Vec3 }
 // `target` is the Euler value as written, so the last write equals Set Asset Property without a transition.
 | { kind: 'rotation'; from: Quat; to: Quat; target: Vec3 };
// The On Transition End output of a Set Asset Property node. `logic` is the logic key of its graph at the write; a changed graph does not run it.
export interface TransitionEnd { graphId: Id; nodeId: Id; logic: string }
// `ends` run when the tween reaches its end on the session clock, never when it stops for another reason.
export interface PropertyTween extends Timing { entityId: Id; property: PropertyKey; value: TweenValue; graphId: Id; ends: readonly TransitionEnd[] }
export type TweenLayer = ReadonlyMap<string, PropertyTween>;
// `pending` holds the ends of writes without a tween; they run on the next clock step.
export interface PropertyLayers { overrides: OverrideLayer; tweens: TweenLayer; pending?: readonly TransitionEnd[] }
export const MAX_TWEENS = 64, MIN_SCALE = 1e-4, MAX_TWEEN_ENDS = 8, MAX_PENDING_ENDS = 64;
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

const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
type SetProperty = Extract<OverrideWrite, { kind: 'setProperty' }>;
const sameValue = (a: readonly number[] | number, b: readonly number[] | number) => JSON.stringify(a) === JSON.stringify(b);
const targetOf = (value: TweenValue) => (value.kind === 'rotation' ? value.target : value.to);
const sameEnd = (a: TransitionEnd, b: TransitionEnd) => a.graphId === b.graphId && a.nodeId === b.nodeId;
// A running tween to the same target keeps running, and `end` joins it. A target equal to the current value starts nothing.
export function startTween(layer: TweenLayer, scene: SceneView, overrides: OverrideLayer, write: SetProperty, transition: Transition, graphId: Id, startMs: number, end?: TransitionEnd): Reply<TweenLayer> {
 const entity = overriddenEntity(scene, overrides, write.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [write.entityId] } };
 const checked = writeProperty(entity, write.property, write.value);
 if (!checked.ok) return checked;
 const id = key(write.entityId, write.property), active = layer.get(id);
 if (active && sameValue(targetOf(active.value), write.value as Vec3 | number)) {
  if (!end || active.ends.some(item => sameEnd(item, end))) return { ok: true, data: layer };
  if (active.ends.length >= MAX_TWEEN_ENDS) return fail('Transition limit reached', [write.entityId]);
  return { ok: true, data: new Map(layer).set(id, { ...active, ends: [...active.ends, end] }) };
 }
 if (!active && JSON.stringify(checked.data) === JSON.stringify(entity)) return { ok: true, data: layer };
 if (!active && layer.size >= MAX_TWEENS) return fail('Transition limit reached', [write.entityId]);
 const current = readProperty(entity, write.property)!;
 const value: TweenValue = write.property === 'rotation'
  ? { kind: 'rotation', from: normalize(entity.transform.rotation as Quat), to: quaternionFromEuler(write.value as Vec3), target: [...write.value as Vec3] }
  : typeof current === 'number' ? { kind: 'number', from: current, to: write.value as number }
  : { kind: 'vector3', from: current as Vec3, to: [...write.value as Vec3] };
 return { ok: true, data: new Map(layer).set(id, { entityId: write.entityId, property: write.property, value, graphId, ends: end ? [end] : [], ...timing(transition, startMs) }) };
}

const without = (layer: TweenLayer, ids: readonly string[]): TweenLayer => {
 if (!ids.some(id => layer.has(id))) return layer;
 const next = new Map(layer);
 for (const id of ids) next.delete(id);
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
 let overrides = layers.overrides;
 const tweens = new Map(layers.tweens), failures: { graphId: Id; error: AppError }[] = [], ended: TransitionEnd[] = [];
 for (const [id, tween] of layers.tweens) {
  const { value, done } = sampleTween(tween, nowMs);
  const written = writeOverride(overrides, scene, { kind: 'setProperty', entityId: tween.entityId, property: tween.property, value }, tween.graphId, nowMs);
  if (!written.ok) { failures.push({ graphId: tween.graphId, error: written.error }); tweens.delete(id); continue; }
  overrides = written.data;
  if (done) { tweens.delete(id); ended.push(...tween.ends); }
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
  for (const tween of layer.values()) if (tween.entityId === entityId && (keys === 'all' || keys.includes(tween.property))) ids.push(key(entityId, tween.property));
 }
 return without(layer, ids);
}

// The graphs that own a tween or one of its ends, and the layer without the tweens and the ends of the given graphs.
export const tweenOwners = (layer: TweenLayer): Id[] => [...layer.values()].flatMap(tween => [tween.graphId, ...tween.ends.map(end => end.graphId)]);
export function dropGraphTweens(layer: TweenLayer, graphIds: ReadonlySet<Id>): TweenLayer {
 const kept = without(layer, [...layer].filter(([, tween]) => graphIds.has(tween.graphId)).map(([id]) => id));
 if (![...kept.values()].some(tween => tween.ends.some(end => graphIds.has(end.graphId)))) return kept;
 return new Map([...kept].map(([id, tween]) => [id, { ...tween, ends: tween.ends.filter(end => !graphIds.has(end.graphId)) }]));
}
