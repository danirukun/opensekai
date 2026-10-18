import type { ScalarValue } from '../blueprint-values';
import { defineNode, empty, type PortShape } from './define';

const pair = (result: 'number' | 'vector3'): PortShape => ({ inputs: { a: 'vector3', b: 'vector3' }, outputs: { result } });
const vector = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape, inputDefaults?: Record<string, ScalarValue>) =>
 defineNode({ type, label, category: 'Math', keywords: ['vector', ...keywords], settings: empty, ports, defaults: () => ({}), fields: [], ...(inputDefaults ? { inputDefaults } : {}) });
export const VECTOR3_NODES = [
 vector('vector3.make', 'Make Vector3', ['xyz', 'compose', 'position'], () => ({ inputs: { x: 'number', y: 'number', z: 'number' }, outputs: { value: 'vector3' } })),
 vector('vector3.break', 'Break Vector3', ['xyz', 'decompose', 'split'], () => ({ inputs: { value: 'vector3' }, outputs: { x: 'number', y: 'number', z: 'number' } })),
 vector('vector3.add', 'Add Vector3', ['plus', 'offset', 'sum'], () => pair('vector3')),
 vector('vector3.scale', 'Scale Vector3', ['multiply', 'times', 'speed'], () => ({ inputs: { value: 'vector3', factor: 'number' }, outputs: { result: 'vector3' } }), { factor: 1 }),
 vector('vector3.subtract', 'Subtract Vector3', ['minus', 'difference', 'offset'], () => pair('vector3')),
 vector('vector3.length', 'Vector3 Length', ['magnitude', 'size', 'norm'], () => ({ inputs: { value: 'vector3' }, outputs: { result: 'number' } })),
 vector('vector3.distance', 'Vector3 Distance', ['distance', 'between', 'far'], () => pair('number')),
 vector('vector3.dot', 'Dot Product', ['dot', 'projection', 'angle'], () => pair('number')),
 vector('vector3.cross', 'Cross Product', ['cross', 'perpendicular', 'normal'], () => pair('vector3')),
 vector('vector3.normalize', 'Normalize Vector3', ['unit', 'direction', 'normal'], () => ({ inputs: { value: 'vector3' }, outputs: { result: 'vector3' } })),
 vector('vector3.lerp', 'Lerp Vector3', ['interpolate', 'mix', 'blend'], () => ({ inputs: { a: 'vector3', b: 'vector3', t: 'number' }, outputs: { result: 'vector3' } }), { t: 0.5 }),
 vector('vector3.moveTowards', 'Move Towards Vector3', ['approach', 'step', 'follow', 'speed'], () => ({ inputs: { current: 'vector3', target: 'vector3', maxDistance: 'number' }, outputs: { result: 'vector3' } }), { maxDistance: 1 }),
 vector('vector3.smoothDamp', 'Smooth Damp Vector3', ['smooth', 'follow', 'spring', 'damping', 'filter'], () => ({ inputs: { target: 'vector3', smoothTime: 'number' }, outputs: { result: 'vector3' } }), { smoothTime: 0.3 }),
 vector('vector3.rotateByEuler', 'Rotate By Euler', ['rotate', 'rotation', 'euler', 'degrees', 'turn'], () => ({ inputs: { value: 'vector3', euler: 'vector3' }, outputs: { result: 'vector3' } })),
 vector('vector3.directionFromEuler', 'Direction From Euler', ['forward', 'direction', 'rotation', 'euler', 'degrees'], () => ({ inputs: { euler: 'vector3' }, outputs: { result: 'vector3' } })),
 vector('vector3.clampLength', 'Clamp Vector3 Length', ['limit', 'magnitude', 'max length'], () => ({ inputs: { value: 'vector3', maxLength: 'number' }, outputs: { result: 'vector3' } }), { maxLength: 1 }),
] as const;
