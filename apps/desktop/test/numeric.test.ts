import { expect, it } from 'vitest';
import { parseFiniteNumber } from '../src/editor/numeric';
it.each(['', ' ', 'NaN', 'Infinity', '1e309'])('rejects %j', text => {
 expect(parseFiniteNumber(text)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
it('accepts finite signed decimals', () => {
 expect(parseFiniteNumber('-1.25')).toEqual({ ok: true, data: -1.25 });
 expect(parseFiniteNumber(' 0 ')).toEqual({ ok: true, data: 0 });
});
