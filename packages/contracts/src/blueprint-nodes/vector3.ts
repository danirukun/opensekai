import { defineNode, empty, type PortShape } from './define';

const vector = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape) =>
 defineNode({ type, label, category: 'Math', keywords: ['vector', ...keywords], settings: empty, ports, defaults: () => ({}), fields: [] });
export const VECTOR3_NODES = [
 vector('vector3.make', 'Make Vector3', ['xyz', 'compose', 'position'], () => ({ inputs: { x: 'number', y: 'number', z: 'number' }, outputs: { value: 'vector3' } })),
 vector('vector3.break', 'Break Vector3', ['xyz', 'decompose', 'split'], () => ({ inputs: { value: 'vector3' }, outputs: { x: 'number', y: 'number', z: 'number' } })),
 vector('vector3.add', 'Add Vector3', ['plus', 'offset', 'sum'], () => ({ inputs: { a: 'vector3', b: 'vector3' }, outputs: { result: 'vector3' } })),
 vector('vector3.scale', 'Scale Vector3', ['multiply', 'times', 'speed'], () => ({ inputs: { value: 'vector3', factor: 'number' }, outputs: { result: 'vector3' } })),
] as const;
