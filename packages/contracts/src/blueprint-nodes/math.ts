import { plainNodes, type PortShape } from './define';

const binary = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
const unary = (): PortShape => ({ inputs: { value: 'number' }, outputs: { result: 'number' } });
const numbers = (...names: string[]): PortShape => ({ inputs: Object.fromEntries(names.map(name => [name, 'number' as const])), outputs: { result: 'number' } });
const math = plainNodes('Math');
export const MATH_NODES = [
 math('math.add', 'Add', ['plus', 'sum', '+'], binary),
 math('math.subtract', 'Subtract', ['minus', 'difference', '-'], binary),
 math('math.multiply', 'Multiply', ['times', 'product', '*', 'scale'], binary),
 math('math.divide', 'Divide', ['quotient', '/', 'ratio'], binary, { b: 1 }),
 math('math.min', 'Min', ['smallest', 'minimum', 'lower'], binary),
 math('math.max', 'Max', ['largest', 'maximum', 'upper'], binary),
 math('math.clamp', 'Clamp', ['limit', 'range', 'bound'], () => ({ inputs: { value: 'number', min: 'number', max: 'number' }, outputs: { result: 'number' } }), { max: 1 }),
 math('math.abs', 'Abs', ['absolute', 'magnitude'], unary),
 math('math.round', 'Round', ['nearest', 'integer'], unary),
 math('math.floor', 'Floor', ['down', 'integer', 'truncate'], unary),
 math('math.random', 'Random Number', ['random', 'chance', 'dice', 'range'], () => ({ inputs: { min: 'number', max: 'number' }, outputs: { result: 'number' } }), { max: 1 }),
 math('math.clamp01', 'Clamp01', ['limit', 'saturate', 'normalize', 'zero one'], unary),
 math('math.remap', 'Remap', ['map', 'range', 'scale', 'convert'], () => ({ inputs: { value: 'number', fromMin: 'number', fromMax: 'number', toMin: 'number', toMax: 'number', clamp: 'boolean' }, outputs: { result: 'number' } }), { fromMax: 1, toMax: 1 }),
 math('math.lerp', 'Lerp', ['interpolate', 'mix', 'blend', 'linear'], () => numbers('a', 'b', 't'), { b: 1, t: 0.5 }),
 math('math.inverseLerp', 'Inverse Lerp', ['interpolate', 'fraction', 'progress', 'percent'], () => numbers('a', 'b', 'value'), { b: 1 }),
 math('math.smoothStep', 'Smooth Step', ['ease', 'smoothstep', 'hermite', 'curve'], () => numbers('min', 'max', 'value'), { max: 1 }),
 math('math.moveTowards', 'Move Towards', ['approach', 'step', 'follow', 'speed'], () => numbers('current', 'target', 'maxDelta'), { maxDelta: 1 }),
 math('math.smoothDamp', 'Smooth Damp', ['smooth', 'follow', 'spring', 'damping', 'filter'], () => numbers('target', 'smoothTime'), { smoothTime: 0.3 }),
 math('math.sin', 'Sin', ['sine', 'wave', 'trigonometry', 'radians'], unary),
 math('math.cos', 'Cos', ['cosine', 'wave', 'trigonometry', 'radians'], unary),
 math('math.tan', 'Tan', ['tangent', 'trigonometry', 'radians'], unary),
 math('math.asin', 'Asin', ['arcsine', 'inverse', 'trigonometry', 'radians'], unary),
 math('math.acos', 'Acos', ['arccosine', 'inverse', 'trigonometry', 'radians'], unary),
 math('math.atan2', 'Atan2', ['arctangent', 'angle', 'direction', 'trigonometry', 'radians'], () => numbers('y', 'x')),
 math('math.degreesToRadians', 'Degrees to Radians', ['angle', 'convert', 'deg', 'rad'], unary),
 math('math.radiansToDegrees', 'Radians to Degrees', ['angle', 'convert', 'deg', 'rad'], unary),
 math('math.pi', 'Pi', ['constant', 'circle', 'π'], () => ({ inputs: {}, outputs: { value: 'number' } })),
 math('math.pow', 'Power', ['pow', 'exponent', 'square', '^'], () => numbers('base', 'exponent'), { exponent: 2 }),
 math('math.sqrt', 'Square Root', ['sqrt', 'root'], unary),
 math('math.exp', 'Exp', ['exponential', 'e'], unary),
 math('math.log', 'Log', ['logarithm', 'ln', 'natural'], unary),
 math('math.sign', 'Sign', ['direction', 'positive', 'negative'], unary),
 math('math.modulo', 'Modulo', ['remainder', '%', 'mod', 'wrap'], binary, { b: 1 }),
] as const;
