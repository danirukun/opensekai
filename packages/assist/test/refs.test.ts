import { expect, it } from 'vitest';
import { assignRefs, emptyRefs, refOf, resolveRef } from '../src';

const ids = (entities: string[], blueprints: string[] = [], assets: string[] = []) => ({ entities, blueprints, assets });

it('keeps references stable and never reuses one', () => {
 const a = assignRefs(emptyRefs(), ids(['x', 'y']));
 const b = assignRefs(a, ids(['y', 'z']));
 expect(refOf(b, 'entity', 'y')).toBe('@e2');
 expect(refOf(b, 'entity', 'z')).toBe('@e3');
 expect(resolveRef(b, '@e1')).toEqual({ kind: 'entity', id: 'x' });
});

it('numbers each kind on its own and keeps the owned list', () => {
 const t = assignRefs({ ...emptyRefs(), owned: ['g1'] }, ids(['x'], ['g1'], ['a1', 'a2']));
 expect(t.owned).toEqual(['g1']);
 expect([refOf(t, 'blueprint', 'g1'), refOf(t, 'asset', 'a2')]).toEqual(['@b1', '@a2']);
 expect(resolveRef(t, '@b1')).toEqual({ kind: 'blueprint', id: 'g1' });
});

it('does not change the input table', () => {
 const a = assignRefs(emptyRefs(), ids(['x']));
 const snapshot = structuredClone(a);
 assignRefs(a, ids(['y']));
 expect(a).toEqual(snapshot);
});

it('resolves nothing for unknown or malformed references', () => {
 const t = assignRefs(emptyRefs(), ids(['x']));
 for (const r of ['@e2', '@x1', 'e1', '@e0', ''])
  expect(resolveRef(t, r)).toBeNull();
});
