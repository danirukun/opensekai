import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LightSettingsSchema,ShowDocumentSchema,rotateByQuaternion,type LightSettings,type SceneEntity} from '@opensekai/contracts';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {BEAM,POINT_LIGHT,SPOT_LIGHT,lightForType,withBeam} from '../src/editor/lights';
import {changedFields,defaultsFor,resetFieldIds} from '../src/editor/property-defaults';
import {SLIDERS} from '../src/editor/slider';

const spotWith=(beam?:LightSettings['beam']):LightSettings=>({...SPOT_LIGHT,...(beam?{beam}:{})});
const entity=(light:LightSettings):SceneEntity=>({...makeAuthoringEntity('spotLight','s',[]),light} as SceneEntity);

describe('beam controls (stage beams R19 to R24)',()=>{
 it('adds a spot light without a beam group and with the haze scatter on (R22)',()=>{
  expect('beam' in SPOT_LIGHT).toBe(false);
  expect(SPOT_LIGHT.volumetric).toBe(true);
  const added=makeAuthoringEntity('spotLight','s',[]);
  expect(added.kind==='light'&&'beam' in added.light).toBe(false);
 });
 it('removes the beam group on a type change (R23)',()=>{
  const lit=spotWith({enabled:true,intensity:2,softness:0.1});
  const point=lightForType('point',lit);
  expect('beam' in point).toBe(false);
  expect(LightSettingsSchema.safeParse(point).success).toBe(true);
  expect('beam' in lightForType('spot',POINT_LIGHT)).toBe(false);
  expect('beam' in lightForType('spot',lightForType('point',lit))).toBe(false);
  expect(lightForType('spot',lit)).toBe(lit);
 });
 it('writes the defaults on the first switch-on and keeps the values on a later switch (R20)',()=>{
  expect(withBeam(SPOT_LIGHT,{enabled:true}).beam).toEqual({...BEAM,enabled:true});
  expect(BEAM).toEqual({enabled:false,intensity:1,softness:0.5});
  const lit=spotWith({enabled:true,intensity:2,softness:0.1});
  expect(withBeam(lit,{enabled:false}).beam).toEqual({enabled:false,intensity:2,softness:0.1});
  expect(withBeam(lit,{intensity:3}).beam).toEqual({enabled:true,intensity:3,softness:0.1});
  expect(withBeam(lit,{softness:0.7})).toMatchObject({...lit,beam:{enabled:true,intensity:2,softness:0.7}});
 });
 it('has a reset mark for the switch on each spot light and for the values while the beam is on (R24)',()=>{
  const off=entity(spotWith());
  expect(resetFieldIds(off)).toContain('beam');
  expect(resetFieldIds(off)).not.toContain('beamIntensity');
  expect(resetFieldIds(off)).not.toContain('beamSoftness');
  expect(changedFields(off).has('beam')).toBe(false);
  const on=entity(spotWith({enabled:true,intensity:2,softness:0.5}));
  const ids=resetFieldIds(on);
  expect(ids.slice(ids.indexOf('penumbra'),ids.indexOf('penumbra')+4)).toEqual(['penumbra','beam','beamIntensity','beamSoftness']);
  expect(changedFields(on).has('beam')).toBe(true);
  expect(changedFields(on).has('beamIntensity')).toBe(true);
  expect(changedFields(on).has('beamSoftness')).toBe(false);
  expect(defaultsFor(on)).toMatchObject({beam:false,beamIntensity:1,beamSoftness:0.5});
  const point=entity(POINT_LIGHT);
  expect(resetFieldIds(point).filter(id=>id.startsWith('beam'))).toEqual([]);
 });
 it('gives the beam sliders the contract ranges (L2, L3)',()=>{
  expect(SLIDERS.beamIntensity).toEqual({min:0,max:4,step:0.01,curve:'linear'});
  expect(SLIDERS.beamSoftness).toEqual({min:0,max:1,step:0.01,curve:'linear'});
 });
});

// The aim points of the plan table. The rotations in the file were computed by hand, so this test checks each one.
const AIMS:Record<string,[number,number,number]>={
 beam_front_1:[-1.5,0,-1],beam_front_2:[-0.5,1.2,0],beam_front_3:[0.5,1.2,0],beam_front_4:[1.5,0,-1],
 beam_back_1:[-2,0,1.5],beam_back_2:[-1,0,2.5],beam_back_3:[1,0,2.5],beam_back_4:[2,0,1.5],
};
const showText=readFileSync(fileURLToPath(new URL('../../../fixtures/shows/stage-beams.osekai',import.meta.url)),'utf8');

describe('stage beams fixture show (R29)',()=>{
 const show=ShowDocumentSchema.parse(JSON.parse(showText));
 const spots=show.scene.entities.filter(e=>e.kind==='light'&&e.light.type==='spot') as Extract<SceneEntity,{kind:'light'}>[];
 it('has 8 spot lights with the beam on, 2 of them with a shadow, and no haze and no avatar',()=>{
  expect(spots.map(e=>e.id).sort()).toEqual(Object.keys(AIMS).sort());
  expect(spots.every(e=>e.light.beam?.enabled===true&&e.light.volumetric===undefined)).toBe(true);
  expect(spots.filter(e=>e.light.shadow.enabled).map(e=>e.id)).toEqual(['beam_front_2','beam_front_3']);
  expect(show.scene.entities.some(e=>e.kind==='haze'||e.kind==='avatar')).toBe(false);
 });
 it('aims each spot light at its point of the plan table, within 0.05 m',()=>{
  for(const e of spots){
   const [px,py,pz]=e.transform.position;
   const [ax,ay,az]=AIMS[e.id]!;
   const [dx,dy,dz]=rotateByQuaternion([0,0,-1],e.transform.rotation);
   const t=(ax-px)*dx+(ay-py)*dy+(az-pz)*dz;
   const miss=Math.hypot(px+t*dx-ax,py+t*dy-ay,pz+t*dz-az);
   expect(t,e.id).toBeGreaterThan(0);
   expect(miss,e.id).toBeLessThan(0.05);
  }
 });
});
