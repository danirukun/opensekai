import { describe, expect, it } from 'vitest';
import { clamp, scrubValue, eulerToQuaternion, quaternionToEuler, menuPosition, transformFromRow } from '../src/editor/interaction';
describe('editor interaction math', () => {
 it('bounds resize and positive scale scrubs', () => { expect(clamp(450,160,360)).toBe(360); expect(scrubValue(1,-200,'scale')).toBe(0.001); expect(scrubValue(2,10,'position')).toBeCloseTo(2.1); });
 it('round trips Euler degrees with normalized rotation', () => { const q=eulerToQuaternion([20,30,40]); expect(Math.hypot(...q)).toBeCloseTo(1); quaternionToEuler(q).forEach((v,i)=>expect(v).toBeCloseTo([20,30,40][i])); });
 it('rejects invalid property values',()=>{const base={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};expect(transformFromRow(base,'scale',[0,1,1])).toBeNull();expect(transformFromRow(base,'position',[Infinity,0,0])).toBeNull();expect(transformFromRow(base,'rotation',[0,0,180])?.rotation[2]).toBeCloseTo(1);});
 it('keeps menus within viewport', () => { expect(menuPosition(990,790,200,250,1000,800)).toEqual({x:796,y:546}); });
});
