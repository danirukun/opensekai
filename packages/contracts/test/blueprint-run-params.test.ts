import { expect, it } from 'vitest';
import { validateCall } from '../src';

it('accepts a Manual Trigger run or a custom event run, never both', () => {
 const ok = (params: unknown) => validateCall('blueprintRun', params).ok;
 expect(ok({ graphId: 'g', triggerNodeId: 'n' })).toBe(true);
 expect(ok({ event: 'show' })).toBe(true);
 expect(ok({ event: 'show', payload: [1, 2, 3] })).toBe(true);
 expect(ok({ event: 'show', payload: 'text' })).toBe(true);
 expect(ok({ graphId: 'g' })).toBe(false);
 expect(ok({ graphId: 'g', triggerNodeId: 'n', payload: 1 })).toBe(false);
 expect(ok({ event: 'show', graphId: 'g', triggerNodeId: 'n' })).toBe(false);
 expect(ok({ event: '  ' })).toBe(false);
 expect(ok({ event: 'x'.repeat(65) })).toBe(false);
 expect(ok({ event: 'show', payload: null })).toBe(false);
 expect(ok({})).toBe(false);
});
