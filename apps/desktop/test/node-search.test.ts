import { expect, it } from 'vitest';
import type { DefaultRefs } from '@opensekai/contracts';
import { searchNodes } from '../src/blueprints/node-search';

const refs: DefaultRefs = { entityId: 'e', cameraId: 'c', outputId: 'o', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'n', type: 'number' }] };
const types = (groups: ReturnType<typeof searchNodes>) => groups.flatMap(group => group.entries.map(entry => entry.type));

it('groups matches by category in palette order and matches keywords', () => {
 const groups = searchNodes('', refs);
 expect(groups[0]!.category).toBe('Events');
 expect(types(searchNodes('hotkey', refs))).toEqual(['event.keystroke']);
 expect(types(searchNodes('cooldown', refs))).toEqual(['flow.throttle']);
 expect(types(searchNodes('cooldown camera', refs))).toEqual([]);
 expect(types(searchNodes('RANDOM', refs))).toEqual(['math.random']);
});

it('hides nodes whose defaults are unavailable', () => {
 const bare: DefaultRefs = { keystroke: refs.keystroke };
 expect(types(searchNodes('visibility', bare))).toEqual([]);
 expect(types(searchNodes('boolean variable', refs))).toEqual([]);
 expect(types(searchNodes('number variable', refs))).toContain('variable.getNumber');
});

it('filters to nodes with a compatible port and names that port', () => {
 const fromBoolean = searchNodes('', refs, { side: 'inputs', type: 'boolean' }).flatMap(group => group.entries);
 expect(fromBoolean.find(entry => entry.type === 'flow.branch')).toEqual({ type: 'flow.branch', label: 'If Branch', port: 'condition' });
 expect(fromBoolean.some(entry => entry.type === 'math.add')).toBe(false);
 const intoNumber = searchNodes('', refs, { side: 'outputs', type: 'number' }).flatMap(group => group.entries);
 expect(intoNumber.find(entry => entry.type === 'flow.forLoop')?.port).toBe('index');
 expect(intoNumber.some(entry => entry.type === 'event.manual')).toBe(false);
});
