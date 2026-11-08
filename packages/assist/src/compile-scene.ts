import { eulerFromQuaternion, LIMITS, quaternionFromEuler, rotateByQuaternion, type LightSettings, type Quat, type Reply, type SceneEntity, type Transform, type Vec3 } from '@opensekai/contracts';
import { lookAt, targetPoint } from './aim';
import type { ColorWord, Direction, Framing, Height, Intensity, Intent, IntentTool } from './intents';
import { WORDS } from './words';
import { create, emit, entityRef, invalid, note, ok, resolveAsset, resolveEntity, resolveTarget, SCENE_ENTITIES, touch, type CompileContext, type Compiler, type WorkingState } from './compile';

type Of<T extends IntentTool> = Extract<Intent, { tool: T }>;
const only = <T extends IntentTool>(tool: T, f: (intent: Of<T>, state: WorkingState, context: CompileContext) => Reply<WorkingState>): Compiler =>
 (intent, state, context) => intent.tool === tool ? f(intent as Of<T>, state, context) : invalid(`Expected ${tool}`);

type Role = Of<'light_setup'>['role'];
const ROLES: Record<Role, { name: string; direction: Direction; height: Height; distance: number; intensity: Intensity; color: ColorWord; shadow: boolean }> = {
 key: { name: 'Key light', direction: 'frontLeft', height: 'high', distance: 3, intensity: 'normal', color: 'neutral', shadow: true },
 fill: { name: 'Fill light', direction: 'frontRight', height: 'eye', distance: 3.5, intensity: 'soft', color: 'neutral', shadow: false },
 rim: { name: 'Rim light', direction: 'backRight', height: 'high', distance: 3, intensity: 'normal', color: 'cool', shadow: false },
 ambient: { name: 'Ambient light', direction: 'above', height: 'high', distance: 0, intensity: 'soft', color: 'neutral', shadow: false },
};
// The editor's spot light defaults (B13 R11).
const SPOT = { range: 15, cone: { angleDegrees: 40, penumbra: 0.3 }, volumetric: true };
const SHADOW = { intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const CAMERA_NAMES: Record<Framing, string> = { wide: 'Wide camera', medium: 'Medium camera', closeUp: 'Close-up camera', extremeCloseUp: 'Extreme close-up camera' };
const PROP_DISTANCE = 1.5, PROP_SPACING = 0.8;
const IDENTITY: Quat = [0, 0, 0, 1];
const transform = (position: Vec3, rotation: Quat = IDENTITY): Transform => ({ position, rotation, scale: [1, 1, 1] });
const count = (state: WorkingState, f: (e: SceneEntity) => boolean) => state.scene.entities.filter(f).length;

const yawOf = (e: SceneEntity): Quat => quaternionFromEuler([0, eulerFromQuaternion(e.transform.rotation)[1], 0]);
// The offset turns with the target's yaw, so `frontLeft` stays in front of a turned avatar. Height is above the target's feet.
const place = (target: SceneEntity, offset: Vec3, height: number): Vec3 => {
 const [x, y, z] = target.transform.position;
 const [dx, dy, dz] = rotateByQuaternion(offset, yawOf(target));
 return [x + dx, y + height + dy, z + dz];
};
const scale = ([x, y, z]: Vec3, k: number): Vec3 => [x * k, y * k, z * k];

export const compileLight = only('light_setup', (i, state, context) => {
 const t = resolveTarget(state, context, i.target);
 if (!t.ok) return t;
 const { target } = t.data;
 const old = i.replace === undefined ? null : resolveEntity(t.data.state, i.replace, ['light'], 'a light');
 if (old && !old.ok) return old;
 const replaced = old?.data ?? null;
 const others = t.data.state.scene.entities.flatMap(e => e.kind === 'light' && e.id !== replaced?.id ? [e] : []);
 if (!replaced && others.length >= LIMITS.lights) return invalid(`Scene has the maximum of ${LIMITS.lights} lights`);
 const role = ROLES[i.role];
 const type = i.role === 'ambient' ? 'ambient' : 'spot';
 const wantShadow = i.shadow ?? role.shadow;
 const shadow = type === 'spot' && wantShadow && others.filter(e => e.light.shadow.enabled).length < LIMITS.shadowLights;
 const light: LightSettings = {
  type, color: WORDS.color[i.color ?? role.color], intensity: WORDS.intensity[i.intensity ?? role.intensity][type], range: type === 'spot' ? SPOT.range : 0,
  affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: shadow, ...SHADOW },
  ...(type === 'spot' ? { cone: { ...SPOT.cone }, volumetric: SPOT.volumetric } : {}),
 };
 const height = WORDS.height[i.height ?? role.height];
 // An ambient light has no place or direction; it stays above the target with no rotation.
 const position = type === 'ambient' ? place(target, [0, 0, 0], height) : place(target, scale(WORDS.direction[i.direction ?? role.direction], role.distance), height);
 const rotation = type === 'ambient' ? IDENTITY : lookAt(position, targetPoint(target));
 if (replaced) {
  const ops = [
   { kind: 'setLight' as const, entityId: replaced.id, light },
   { kind: 'setTransform' as const, entityId: replaced.id, transform: { position, rotation, scale: replaced.transform.scale } },
   ...(i.name !== undefined && i.name !== replaced.name ? [{ kind: 'renameEntity' as const, entityId: replaced.id, name: i.name }] : []),
  ];
  const next = note(touch(emit(t.data.state, ops), replaced.id), { code: 'replacedExisting', ref: i.replace! });
  return ok(wantShadow && !shadow ? note(next, { code: 'shadowSkipped', ref: i.replace! }) : next);
 }
 const id = context.newId('light');
 const made = create(t.data.state, { id, name: i.name ?? role.name, visible: true, kind: 'light', transform: transform(position, rotation), light });
 if (!made.ok || !wantShadow || shadow) return made;
 const ref = entityRef(made.data, id);
 return ok(note(made.data, ref ? { code: 'shadowSkipped', ref } : { code: 'shadowSkipped' }));
});

export const compileCamera = only('camera_add', (i, state, context) => {
 const t = resolveTarget(state, context, i.target);
 if (!t.ok) return t;
 if (count(t.data.state, e => e.kind === 'camera') >= LIMITS.cameras) return invalid(`Scene has the maximum of ${LIMITS.cameras} cameras`);
 const { target } = t.data;
 const framing = WORDS.framing[i.framing];
 const aim = targetPoint(target, i.framing);
 // With no height word the camera is level with the aim point.
 const height = i.height ? WORDS.height[i.height] : aim[1] - target.transform.position[1];
 const position = place(target, scale(WORDS.direction[i.side ?? 'front'], framing.distance), height);
 return create(t.data.state, {
  id: context.newId('camera'), name: i.name ?? CAMERA_NAMES[i.framing], visible: true, kind: 'camera',
  transform: transform(position, lookAt(position, aim)), lens: { fovDegrees: framing.fovDegrees, near: 0.01, far: 100 },
 });
});

export const compileEnvironment = only('environment_set', (i, state, context) => {
 const asset = resolveAsset(state, context, i.asset, ['scene', 'fixture'], 'a scene asset');
 if (!asset.ok) return asset;
 const reflections = i.reflections === undefined ? undefined : WORDS.reflections[i.reflections];
 const env = state.scene.entities.find(e => e.kind === 'environment');
 if (!env) return create(state, {
  id: context.newId('environment'), name: asset.data.name, visible: true, kind: 'environment', assetId: asset.data.id,
  ...(reflections === undefined ? {} : { reflectionsIntensity: reflections }), transform: transform([0, 0, 0]),
 });
 return ok(touch(emit(state, [
  { kind: 'setEnvironmentModel', entityId: env.id, assetId: asset.data.id },
  ...(reflections === undefined ? [] : [{ kind: 'setEnvironmentReflections' as const, entityId: env.id, reflectionsIntensity: reflections }]),
 ]), env.id));
});

const RELATIONS: Record<'front' | 'behind' | 'left' | 'right', Vec3> = { front: [0, 0, 1], behind: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] };
// `around` spreads the props on a circle that starts in front; a side relation puts them in a row across that side.
const propOffsets = (relation: keyof typeof RELATIONS | 'around', n: number): Vec3[] => Array.from({ length: n }, (_, k): Vec3 => {
 if (relation === 'around') { const a = 2 * Math.PI * k / n; return [Math.sin(a) * PROP_DISTANCE, 0, Math.cos(a) * PROP_DISTANCE]; }
 const [dx, , dz] = RELATIONS[relation];
 const across = (k - (n - 1) / 2) * PROP_SPACING;
 return [dx * PROP_DISTANCE - dz * across, 0, dz * PROP_DISTANCE + dx * across];
});

export const compileProps = only('prop_place', (i, state, context) => {
 const asset = resolveAsset(state, context, i.asset, ['scene', 'fixture'], 'a prop asset');
 if (!asset.ok) return asset;
 const t = resolveTarget(state, context, i.near);
 if (!t.ok) return t;
 const want = i.count ?? 1;
 const n = Math.min(want, SCENE_ENTITIES - t.data.state.scene.entities.length);
 if (n < 1) return invalid(`Scene has the maximum of ${SCENE_ENTITIES} entities`);
 const base = i.name ?? asset.data.name;
 const start = n < want ? note(t.data.state, { code: 'countClamped', ref: i.asset }) : t.data.state;
 const rotation = yawOf(t.data.target);
 return propOffsets(i.relation ?? (want > 1 ? 'around' : 'front'), n).reduce<Reply<WorkingState>>((r, offset, k) => !r.ok ? r : create(r.data, {
  id: context.newId('prop'), name: want > 1 ? `${base} ${k + 1}` : base, visible: true, kind: 'mesh',
  source: { kind: 'asset', assetId: asset.data.id }, transform: transform(place(t.data.target, offset, 0), rotation),
 }), ok(start));
});

// The editor's haze box (B13 R14).
const HAZE_BOX: Transform = { position: [0, 4, 0], rotation: IDENTITY, scale: [20, 8, 20] };

export const compileHaze = only('haze_set', (i, state, context) => {
 const haze = { ...WORDS.haze[i.density] };
 const existing = state.scene.entities.find(e => e.kind === 'haze');
 if (existing) return ok(touch(emit(state, [{ kind: 'setHaze', entityId: existing.id, haze }]), existing.id));
 if (i.density === 'off') return ok(state);
 return create(state, { id: context.newId('haze'), name: 'Haze', visible: true, kind: 'haze', haze, transform: structuredClone(HAZE_BOX) });
});

export const compileOutput = only('output_camera', (i, state) => {
 const camera = resolveEntity(state, i.camera, ['camera'], 'a camera');
 if (!camera.ok) return camera;
 const [first, ...rest] = state.scene.outputs;
 if (!first) return invalid('Scene has no output');
 return ok({
  ...state, scene: { ...state.scene, outputs: [{ ...first, cameraId: camera.data.id }, ...rest] },
  proposal: { ...state.proposal, output: { outputId: first.id, cameraId: camera.data.id } },
 });
});
