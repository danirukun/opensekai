import { plainNodes } from './define';

const color = plainNodes('Math', ['color', 'colour', 'rgb']);
export const COLOR_NODES = [
 color('color.make', 'Make Color', ['compose', 'channels', 'red', 'green', 'blue'], () => ({ inputs: { r: 'number', g: 'number', b: 'number' }, outputs: { value: 'color' } })),
 color('color.break', 'Break Color', ['decompose', 'split', 'channels'], () => ({ inputs: { value: 'color' }, outputs: { r: 'number', g: 'number', b: 'number' } })),
] as const;
