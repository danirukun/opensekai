import type { Vec3 } from '@opensekai/contracts';
import type { EvaluatorTable, Read } from './types';

const vec = (read: Read, port: string) => read(port) as Vec3;
export const VECTOR3_EVALUATORS = {
 'vector3.make': { data: (_n, _o, read) => [Number(read('x')), Number(read('y')), Number(read('z'))] as Vec3 },
 'vector3.break': { data: (_n, output, read) => vec(read, 'value')[output === 'x' ? 0 : output === 'y' ? 1 : 2]! },
 'vector3.add': { data: (_n, _o, read) => { const a = vec(read, 'a'), b = vec(read, 'b'); return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vec3; } },
 'vector3.scale': { data: (_n, _o, read) => { const v = vec(read, 'value'), f = Number(read('factor')); return [v[0] * f, v[1] * f, v[2] * f] as Vec3; } },
} satisfies Partial<EvaluatorTable>;
