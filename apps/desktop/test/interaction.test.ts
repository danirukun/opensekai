import { describe, expect, it } from 'vitest';
import type {Transform} from '@opensekai/contracts';
import { copyTransform, initialTransformFields, clamp, scrubValue, eulerToQuaternion, quaternionToEuler, menuPosition, transformFromRow, reconcileTransformFields } from '../src/editor/interaction';
describe('editor interaction math', () => {
 it('bounds resize and positive scale scrubs', () => { expect(clamp(450,160,360)).toBe(360); expect(scrubValue(1,-200,'scale')).toBe(0.001); expect(scrubValue(2,10,'position')).toBeCloseTo(2.1); });
 it('round trips Euler degrees with normalized rotation', () => { const q=eulerToQuaternion([20,30,40]); expect(Math.hypot(...q)).toBeCloseTo(1); quaternionToEuler(q).forEach((v,i)=>expect(v).toBeCloseTo([20,30,40][i])); });
 it('rejects invalid property values',()=>{const base={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};expect(transformFromRow(base,'scale',[0,1,1])).toBeNull();expect(transformFromRow(base,'position',[Infinity,0,0])).toBeNull();expect(transformFromRow(base,'rotation',[0,0,180])?.rotation[2]).toBeCloseTo(1);});
 it('keeps menus within viewport', () => { expect(menuPosition(990,790,200,250,1000,800)).toEqual({x:796,y:546}); });
});

describe('ordinary transform input reconciliation',()=>{
 const transform={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};
 const source={entityId:'asset_one',revision:7,transform};
 const typed={position:['12.','-','0'],rotation:['0','0','0'],scale:['1','1','1']};
 it('keeps partially typed input through same-revision inspection clones',()=>{
  const initial=reconcileTransformFields(null,source,typed);
  const polled=reconcileTransformFields(initial.key,structuredClone(source),typed);
  expect(polled.values).toBe(typed);
 });
 it('reloads on external revision, selected identity, or actual base transform change',()=>{
  const initial=reconcileTransformFields(null,source,typed);
  for(const changed of [{...source,revision:8},{...source,entityId:'asset_two'},{...source,transform:{...transform,position:[3,0,0] as [number,number,number]}}]){
   const result=reconcileTransformFields(initial.key,changed,typed);
   expect(result.values).not.toBe(typed); expect(result.values.position[0]).toBe(String(changed.transform.position[0]));
  }
 });
});

it('initializes every bound input before mount and copies reactive transforms without structuredClone',()=>{
 const transform={position:[1,2,3],rotation:[0,0,0,1],scale:[1,1,1]} as Transform;
 const reactive=new Proxy(transform,{get:(target,key)=>Reflect.get(target,key)});
 expect(()=>structuredClone(reactive)).toThrow();
 expect(initialTransformFields(reactive)).toEqual({position:['1','2','3'],rotation:['0','0','0'],scale:['1','1','1']});
 const copy=copyTransform(reactive);expect(structuredClone(copy)).toEqual(transform);copy.position[0]=9;expect(transform.position[0]).toBe(1);
 expect(transformFromRow(reactive,'position',[4,5,6])?.position).toEqual([4,5,6]);
});

it('parses a complete live transform and keeps partial or invalid values local',async()=>{
 const {transformFromFields}=await import('../src/editor/interaction');
 const fields={position:['1','2','3'],rotation:['0','90','0'],scale:['2','3','4']};
 expect(transformFromFields(fields)).toEqual({position:[1,2,3],rotation:eulerToQuaternion([0,90,0]),scale:[2,3,4]});
 for(const value of ['','-','1e','Infinity','NaN'])expect(transformFromFields({...fields,position:[value,'2','3']})).toBeNull();
 for(const value of ['0','-1'])expect(transformFromFields({...fields,scale:[value,'3','4']})).toBeNull();
});
