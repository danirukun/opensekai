import { quaternionFromEuler, rotateByQuaternion, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type Easing, type SceneEntity, type Vec3 } from '@opensekai/contracts';
import { eulerDegrees, lookAt, targetPoint } from './aim';
import { COLUMN, invalid, ok, only, putGraph, resolveEntity, resolveTarget, withProposal } from './compile-kit';
import type { EasingWord, Framing, Intent } from './intents';
import { WORDS } from './words';

type Move = Extract<Intent, { tool: 'camera_move' }>;
type Waypoint = { position: Vec3; aim: Vec3 };

const MAX_STEP = 15, DEFAULT_ANGLE = 90, CRANE_RISE = 1.5, CRANE_FLOOR = 0.2, EPS = 1e-9;
const ROW = 160, GRAPH_NAME = 128;
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
type Link = [source: string, port: string, target: string];

// Play → start (snap to the pose at compile time, 0 s) → step_1 → … → step_n. Each step sets position, then (exit) rotation;
// its transitionEnd starts the next step (the Camera Sway pattern). The field of view joins the last step; a loop returns to the start.
const moveGraph = (id: string, name: string, camera: Extract<SceneEntity, { kind: 'camera' }>, points: Waypoint[], i: Move): BlueprintGraph => {
 const seconds = WORDS.duration[i.duration ?? 'normal'] / points.length;
 const ease = easings(i.easing ?? 'smooth', points.length, i.loop === true);
 const settings = (property: string, k: number) => ({ entityId: camera.id, property, transitionSeconds: seconds, easing: ease[k]! });
 const snap = (property: string) => ({ entityId: camera.id, property, transitionSeconds: 0 });
 const step = (k: number) => `step_${k + 1}`;
 const last = points.length - 1;
 const nodes: BlueprintNode[] = [
  { id: 'play', version: 1, type: 'event.manual', position: { x: 0, y: 0 }, settings: {} },
  setNode('start', COLUMN, 0, snap('position'), [...camera.transform.position]),
  setNode('start_rotation', COLUMN, ROW, snap('rotation'), eulerDegrees(camera.transform.rotation)),
  setNode('start_fov', COLUMN, 2 * ROW, snap('fovDegrees'), camera.lens.fovDegrees),
  ...points.flatMap((w, k) => [
   setNode(step(k), COLUMN * (k + 2), 0, settings('position', k), w.position),
   setNode(`${step(k)}_rotation`, COLUMN * (k + 2), ROW, settings('rotation', k), eulerDegrees(lookAt(w.position, w.aim))),
  ]),
  ...(i.endFraming ? [setNode('fov', COLUMN * (last + 3), ROW, settings('fovDegrees', last), WORDS.framing[i.endFraming].fovDegrees)] : []),
 ];
 const links: Link[] = [
  ['play', 'flow', 'start'], ['start', 'exit', 'start_rotation'], ['start_rotation', 'exit', 'start_fov'], ['start', 'transitionEnd', step(0)],
  ...points.flatMap((_, k): Link[] => [[step(k), 'exit', `${step(k)}_rotation`], ...(k < last ? [[step(k), 'transitionEnd', step(k + 1)] as Link] : [])]),
  ...(i.loop ? [[step(last), 'transitionEnd', 'start'] as Link] : []),
  ...(i.endFraming ? [[`${step(last)}_rotation`, 'exit', 'fov'] as Link] : []),
 ];
 const connections: BlueprintConnection[] = links.map(([sourceNodeId, sourcePort, targetNodeId], k) => ({ id: `wire_${k + 1}`, sourceNodeId, sourcePort, targetNodeId, targetPort: 'flow' }));
 return { schemaVersion: 1, id, name, enabled: true, nodes, connections, variables: [] };
};

export const compileCameraMove = only('camera_move', (i, state, context) => {
 const resolved = resolveEntity(state, i.camera, ['camera'], 'a camera');
 if (!resolved.ok) return resolved;
 const camera = resolved.data;
 if (camera.kind !== 'camera') return invalid(`${i.camera} is not a camera`, [i.camera]);
 // A selected camera is the one that moves, not the target, so the fallback skips it.
 const t = resolveTarget(state, context.selection === camera.id ? { ...context, selection: null } : context, i.target);
 if (!t.ok) return t;
 const { target } = t.data;
 if (target.id === camera.id) return invalid('A camera cannot orbit or aim at itself', [i.target ?? i.camera]);
 const points = i.kind === 'orbit' ? orbit(i, camera, target) : [i.kind === 'crane' ? crane(i, camera, target) : line(i.kind, i, camera, target)];
 const id = context.newId('blueprint');
 const name = (i.name ?? `${camera.name} ${MOVE_NAMES[i.kind]}`).slice(0, GRAPH_NAME).trim();
 const put = putGraph(t.data.state, moveGraph(id, name, camera, points, i), null);
 return put.ok ? ok(withProposal(put.data, p => ({ play: [...p.play, { graphId: id, nodeId: 'play' }] }))) : put;
});
