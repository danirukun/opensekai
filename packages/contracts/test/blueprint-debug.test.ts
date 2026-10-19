import { expect, it } from 'vitest';
import { BlueprintDebugSchema, blueprintNodeCatalog, BlueprintNodeSchema, blueprintPorts, formatDebugValue, MAX_DEBUG_TEXT, plainDebugText, validateCall, type BlueprintNode } from '../src';

it('formats each data type as plain text', () => {
 expect(formatDebugValue('number', 0.1 + 0.2)).toBe('0.30000000000000004');
 expect(formatDebugValue('number', -0)).toBe('0');
 expect(formatDebugValue('integer', 42)).toBe('42');
 expect(formatDebugValue('boolean', false)).toBe('false');
 expect(formatDebugValue('string', '')).toBe('""');
 expect(formatDebugValue('string', 'a\n"b"')).toBe('"a\\n\\"b\\""');
 expect(formatDebugValue('vector3', [1, -2.5, 0])).toBe('(1, -2.5, 0)');
 expect(formatDebugValue('number[]', [])).toBe('[]');
 expect(formatDebugValue('integer[]', [1, 2])).toBe('[1, 2]');
 expect(formatDebugValue('boolean[]', [true, false])).toBe('[true, false]');
 expect(formatDebugValue('string[]', ['a', ''])).toBe('["a", ""]');
 expect(formatDebugValue('vector3[]', [[0, 0, 1]])).toBe('[(0, 0, 1)]');
});

it('cuts long text at a code point boundary', () => {
 const long = formatDebugValue('string', 'x'.repeat(1000));
 expect(long).toHaveLength(MAX_DEBUG_TEXT);
 expect(long.endsWith('…')).toBe(true);
 // An emoji across the cut stays whole or goes out whole.
 const emoji = formatDebugValue('string', `${'x'.repeat(253)}😀😀`);
 expect(emoji.length).toBeLessThanOrEqual(MAX_DEBUG_TEXT);
 expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji)).toBe(false);
 expect(formatDebugValue('number[]', Array.from({ length: 256 }, (_, i) => i)).length).toBe(MAX_DEBUG_TEXT);
});

it('replaces control characters and keeps markup as text', () => {
 expect(plainDebugText('<b>hi</b>\n\t\u0007*x*\u0085')).toBe('<b>hi</b>   *x* ');
 expect(plainDebugText('a\u2028b\u2029c')).toBe('a b c');
 expect(formatDebugValue('string', 'a\u0085b\u2028c')).toBe('"a b c"');
 expect(formatDebugValue('string[]', ['\u2029'])).toBe('[" "]');
});

it('gives the debug nodes their typed ports', () => {
 const node = (type: string, settings: object) => BlueprintNodeSchema.parse({ id: 'n', version: 1, type, settings, position: { x: 0, y: 0 } }) as BlueprintNode;
 expect(blueprintPorts(node('debug.value', { valueType: 'string[]' }))).toEqual({ inputs: { value: 'string[]' }, outputs: { value: 'string[]' } });
 expect(blueprintPorts(node('debug.event', { payloadType: 'none' })).inputs).toEqual({ flow: 'flow', name: 'string' });
 expect(blueprintPorts(node('debug.event', { payloadType: 'vector3' })).inputs).toEqual({ flow: 'flow', name: 'string', payload: 'vector3' });
 expect(() => node('debug.toast', { variant: 'info', durationSeconds: 0.5 })).toThrow();
 expect(() => node('debug.log', { level: 'trace' })).toThrow();
 expect(blueprintNodeCatalog().filter(entry => entry.category === 'Debug').map(entry => entry.type)).toEqual(['debug.log', 'debug.toast', 'debug.value', 'debug.event']);
});

it('validates the blueprintDebug call and reply shapes', () => {
 expect(validateCall('blueprintDebug', {}).ok).toBe(true);
 expect(validateCall('blueprintDebug', { since: 4 }).ok).toBe(true);
 expect(validateCall('blueprintDebug', { since: -1 }).ok).toBe(false);
 expect(validateCall('blueprintDebug', { since: 1, graphId: 'g' }).ok).toBe(false);
 const entry = { seq: 1, atMs: 16, graphId: 'g', nodeId: 'n', kind: 'log', level: 'info', message: 'hi' };
 expect(BlueprintDebugSchema.safeParse({ epoch: 'e', latest: 1, next: 1, dropped: 0, entries: [entry], values: [] }).success).toBe(true);
 expect(BlueprintDebugSchema.safeParse({ epoch: 'e', latest: 1, next: 1, dropped: 0, entries: [{ ...entry, level: 'trace' }], values: [] }).success).toBe(false);
 expect(BlueprintDebugSchema.safeParse({ epoch: 'e', latest: 1, next: 1, dropped: 0, entries: Array.from({ length: 51 }, (_, i) => ({ ...entry, seq: i + 1 })), values: [] }).success).toBe(false);
});
