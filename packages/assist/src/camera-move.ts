import { quaternionFromEuler, rotateByQuaternion, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type Easing, type SceneEntity, type Vec3 } from '@opensekai/contracts';
import { eulerDegrees, lookAt, targetPoint } from './aim';
import { invalid, ok, only, putGraph, resolveEntity, resolveTarget, withProposal } from './compile-kit';
import type { EasingWord, Framing, Intent } from './intents';
import { WORDS } from './words';

type Move = Extract<Intent, { tool: 'camera_move' }>;
type Waypoint = { position: Vec3; aim: Vec3 };

const MAX_STEP = 15, DEFAULT_ANGLE = 90, CRANE_RISE = 1.5, CRANE_FLOOR = 0.2, EPS = 1e-9;
const COLUMN = 240, ROW = 160;
const MOVE_NAMES: Record<Move['kind'], string> = { orbit: 'orbit', dolly: 'dolly', pushIn: 'push-in', pullOut: 'pull-out', crane: 'crane' };
const STRAIGHT_FRAMING: Record<'dolly' | 'pushIn' | 'pullOut', Framing> = { dolly: 'medium', pushIn: 'closeUp', pullOut: 'wide' };
const EASE_IN: Record<EasingWord, Easing> = { smooth: 'InSine', linear: 'Linear', easeIn: 'InQuad', easeOut: 'Linear' };
const EASE_OUT: Record<EasingWord, Easing> = { smooth: 'OutSine', linear: 'Linear', easeIn: 'Linear', easeOut: 'OutQuad' };

// Cumulative angles of equal steps of at most 15°. The last angle is the full angle, so a 360° orbit ends on its start point once.
export const orbitSteps = (angleDegrees: number): number[] => {
 const n = Math.max(1, Math.ceil(angleDegrees / MAX_STEP - EPS));
 return Array.from({ length: n }, (_, k) => k + 1 === n ? angleDegrees : angleDegrees * (k + 1) / n);
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const along = (from: Vec3, dir: Vec3, k: number): Vec3 => [from[0] + dir[0] * k, from[1] + dir[1] * k, from[2] + dir[2] * k];
const unit = (v: Vec3, fallback: Vec3): Vec3 => { const n = Math.hypot(...v); return n < EPS ? fallback : [v[0] / n, v[1] / n, v[2] / n]; };

// The orbit turns about the vertical axis through the target. `right` moves the camera to its own right (+Y rotation).
// With an end framing, the radius and the height go to that framing over the whole orbit.
const orbit = (i: Move, camera: SceneEntity, target: SceneEntity): Waypoint[] => {
 const center = target.transform.position, start = camera.transform.position;
 const aim = targetPoint(target, i.endFraming);
 const flat: Vec3 = [start[0] - center[0], 0, start[2] - center[2]];
 const r0 = Math.hypot(flat[0], flat[2]) < EPS ? WORDS.framing[i.endFraming ?? 'medium'].distance : Math.hypot(flat[0], flat[2]);
 const r1 = i.endFraming ? WORDS.framing[i.endFraming].distance : r0;
 const y1 = i.endFraming ? aim[1] : start[1];
 const dir = unit(flat, [0, 0, 1]), angle = i.angleDegrees ?? DEFAULT_ANGLE, sign = i.turn === 'left' ? -1 : 1;
 return orbitSteps(angle).map(a => {
  const t = a / angle, [dx, , dz] = rotateByQuaternion(dir, quaternionFromEuler([0, sign * a, 0]));
  return { position: [center[0] + dx * (r0 + (r1 - r0) * t), start[1] + (y1 - start[1]) * t, center[2] + dz * (r0 + (r1 - r0) * t)], aim };
 });
};

// Dolly, push-in, and pull-out move along the line from the aim point to the camera, to the framing distance.
const line = (kind: keyof typeof STRAIGHT_FRAMING, i: Move, camera: SceneEntity, target: SceneEntity): Waypoint => {
 const framing = i.endFraming ?? STRAIGHT_FRAMING[kind];
 const aim = targetPoint(target, framing);
 return { position: along(aim, unit(sub(camera.transform.position, aim), [0, 0, 1]), WORDS.framing[framing].distance), aim };
};
// A crane moves straight up or down and keeps the camera above the floor.
const crane = (i: Move, camera: SceneEntity, target: SceneEntity): Waypoint => {
 const [x, y, z] = camera.transform.position;
 return { position: [x, i.rise === 'down' ? Math.max(CRANE_FLOOR, y - CRANE_RISE) : y + CRANE_RISE, z], aim: targetPoint(target, i.endFraming) };
};

// One step takes the easing word. A chain eases in on its first step and out on its last and keeps one speed between, so the
// steps do not pulse; a loop keeps one speed throughout.
const easings = (word: EasingWord, n: number, loop: boolean): Easing[] =>
 n === 1 ? [WORDS.easing[word]] : Array.from({ length: n }, (_, k) => loop ? 'Linear' : k === 0 ? EASE_IN[word] : k === n - 1 ? EASE_OUT[word] : 'Linear');

const setNode = (id: string, x: number, y: number, settings: object, value: Vec3 | number): BlueprintNode =>
 ({ id, version: 1, type: 'property.set', position: { x, y }, settings, inputs: { value } }) as BlueprintNode;

// Play → step_1 (position) → exit → step_1_rotation; step_k transitionEnd → step_k+1 (the Camera Sway pattern). The field of view joins the last step.
const moveGraph = (id: string, name: string, cameraId: string, points: Waypoint[], i: Move): BlueprintGraph => {
 const seconds = WORDS.duration[i.duration ?? 'normal'] / points.length;
 const ease = easings(i.easing ?? 'smooth', points.length, i.loop === true);
 const settings = (property: string, k: number) => ({ entityId: cameraId, property, transitionSeconds: seconds, easing: ease[k]! });
 const step = (k: number) => `step_${k + 1}`;
 const nodes: BlueprintNode[] = [
  { id: 'play', version: 1, type: 'event.manual', position: { x: 0, y: 0 }, settings: {} },
  ...points.flatMap((w, k) => [
   setNode(step(k), COLUMN * (k + 1), 0, settings('position', k), w.position),
   setNode(`${step(k)}_rotation`, COLUMN * (k + 1), ROW, settings('rotation', k), eulerDegrees(lookAt(w.position, w.aim))),
  ]),
  ...(i.endFraming ? [setNode('fov', COLUMN * (points.length + 1), ROW, settings('fovDegrees', points.length - 1), WORDS.framing[i.endFraming].fovDegrees)] : []),
 ];
 const last = points.length - 1;
 const links: [string, string, string][] = [
  ['play', 'flow', step(0)],
  ...points.flatMap((_, k): [string, string, string][] => [[step(k), 'exit', `${step(k)}_rotation`], ...(k < last ? [[step(k), 'transitionEnd', step(k + 1)] as [string, string, string]] : [])]),
  ...(i.loop ? [[step(last), 'transitionEnd', step(0)] as [string, string, string]] : []),
  ...(i.endFraming ? [[`${step(last)}_rotation`, 'exit', 'fov'] as [string, string, string]] : []),
 ];
 const connections: BlueprintConnection[] = links.map(([sourceNodeId, sourcePort, targetNodeId], k) => ({ id: `wire_${k + 1}`, sourceNodeId, sourcePort, targetNodeId, targetPort: 'flow' }));
 return { schemaVersion: 1, id, name, enabled: true, nodes, connections, variables: [] };
};

export const compileCameraMove = only('camera_move', (i, state, context) => {
 const camera = resolveEntity(state, i.camera, ['camera'], 'a camera');
 if (!camera.ok) return camera;
 const t = resolveTarget(state, context, i.target);
 if (!t.ok) return t;
 if (t.data.target.id === camera.data.id) return invalid('A camera cannot orbit or aim at itself', [i.target ?? i.camera]);
 const { target } = t.data;
 const points = i.kind === 'orbit' ? orbit(i, camera.data, target) : [i.kind === 'crane' ? crane(i, camera.data, target) : line(i.kind, i, camera.data, target)];
 const id = context.newId('blueprint');
 const put = putGraph(t.data.state, moveGraph(id, i.name ?? `${camera.data.name} ${MOVE_NAMES[i.kind]}`, camera.data.id, points, i), null);
 return put.ok ? ok(withProposal(put.data, p => ({ play: [...p.play, { graphId: id, nodeId: 'play' }] }))) : put;
});
