import { expect, it } from 'vitest';
import { blueprintNodeCatalog, type BlueprintValue } from '@opensekai/contracts';
import { EVALUATORS, emptyState, NO_ENV, type Evaluator } from '../src/blueprint-eval';

type Inputs = Record<string, BlueprintValue>;
// Calls one data evaluator with explicit inputs. A missing input is a test mistake, not a default.
const evaluate = (type: string, inputs: Inputs, output = 'value', settings: object = {}): BlueprintValue => {
 const node = { id: 'n', version: 1, type, settings, position: { x: 0, y: 0 } };
 const read = (port: string) => { if (!Object.hasOwn(inputs, port)) throw new Error(`Test input ${port} is missing`); return inputs[port]!; };
 return (EVALUATORS[type as keyof typeof EVALUATORS] as Evaluator<never>).data!(node as never, output, read, emptyState(), NO_ENV);
};
const make = (r: number, g: number, b: number) => evaluate('color.make', { r, g, b });

it('gives the setting of a Color value node', () => {
 expect(evaluate('value.color', {}, 'value', { value: '#336699' })).toBe('#336699');
});

it('makes a color from three channels in 0–1', () => {
 expect(make(1, 0.5, 0)).toBe('#ff8000');
 expect(make(0, 0, 0)).toBe('#000000');
 expect(make(1, 1, 1)).toBe('#ffffff');
});

it('clamps each channel to 0–1 and reads a non-finite channel as 0', () => {
 expect(make(2, -1, Number.NaN)).toBe('#ff0000');
 expect(make(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.25)).toBe('#000040');
});

it('rounds each channel to the nearest of the 255 steps', () => {
 expect(make(0.5 / 255, 1.49 / 255, 1.51 / 255)).toBe('#010102');
 expect(make(127.5 / 255, 254.5 / 255, 254.49 / 255)).toBe('#80fffe');
});

it('breaks a color into three channels of byte / 255', () => {
 expect(['r', 'g', 'b'].map(output => evaluate('color.break', { value: '#ff8000' }, output))).toEqual([1, 128 / 255, 0]);
 const channels = ['r', 'g', 'b'].map(output => evaluate('color.break', { value: '#0a0b0c' }, output) as number);
 expect(make(channels[0]!, channels[1]!, channels[2]!)).toBe('#0a0b0c');
});

it('lists the three color nodes in the catalog with their categories and ports', () => {
 const entry = (type: string) => blueprintNodeCatalog().find(node => node.type === type);
 expect(entry('value.color')).toMatchObject({ label: 'Color', category: 'Values', ports: { inputs: {}, outputs: { value: 'color' } } });
 expect(entry('color.make')).toMatchObject({ label: 'Make Color', category: 'Math', ports: { inputs: { r: 'number', g: 'number', b: 'number' }, outputs: { value: 'color' } } });
 expect(entry('color.break')).toMatchObject({ label: 'Break Color', category: 'Math', ports: { inputs: { value: 'color' }, outputs: { r: 'number', g: 'number', b: 'number' } } });
});
