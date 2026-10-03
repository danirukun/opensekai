import { expect, it } from 'vitest';
import { parseOperatorDescriptor } from '../src/cli';
const descriptor = { schemaVersion: 1, sessionId: 's', httpOrigin: 'http://127.0.0.1:41000', wsUrl: 'ws://127.0.0.1:41000/ws', role: 'operator', token: 'fixture', capabilities: ['read'], outputId: null };
it('accepts only operator credentials without widening grants', () => {
 expect(parseOperatorDescriptor(descriptor)).toEqual({ ok: true, data: descriptor });
 expect(parseOperatorDescriptor({...descriptor, role: 'renderer', outputId: 'output_main'})).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
 expect(parseOperatorDescriptor({...descriptor, extra:true})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
});
