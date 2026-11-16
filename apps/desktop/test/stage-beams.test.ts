import {describe,expect,it} from 'vitest';
import {LightSettingsSchema,type LightSettings,type SceneEntity} from '@opensekai/contracts';
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
