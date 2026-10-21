import {describe,expect,it} from 'vitest';
import {ARKIT_NAMES,DEFAULT_TRACKING_SMOOTHING,EXPRESSION_STEPS,TRACKING_PRESETS,TrackingConfigSchema,TrackingSmoothingSchema} from '../src';

const ORDER=['blink','mouthWide','browsUp','smile','frown','pucker','puffCheeks','tongueOut','lookAround'];

describe('tracking presets',()=>{
 it('lists SelfReflect, iFacialMocap, Other VMC app in order',()=>{
  expect(TRACKING_PRESETS.map(p=>[p.id,p.label])).toEqual([['selfreflect','SelfReflect'],['ifacialmocap','iFacialMocap'],['vmc','Other VMC app']]);
 });
 it('has valid enabled configs bound to all interfaces',()=>{
  for(const preset of TRACKING_PRESETS){
   expect(TrackingConfigSchema.safeParse(preset.config).success).toBe(true);
   expect(preset.config).toMatchObject({enabled:true,bindAddress:'0.0.0.0'});
  }
  expect(TRACKING_PRESETS.map(p=>[p.config.kind,(p.config as {port:number}).port])).toEqual([['vmc',39539],['ifacialmocap',49983],['vmc',39539]]);
 });
 it('uses the default smoothing',()=>{
  for(const preset of TRACKING_PRESETS){
   expect(TrackingSmoothingSchema.safeParse(preset.smoothing).success).toBe(true);
   expect(preset.smoothing).toEqual(DEFAULT_TRACKING_SMOOTHING);
  }
 });
 it('fills the face slot only for iFacialMocap and asks for the phone',()=>{
  const phone=TRACKING_PRESETS.find(p=>p.id==='ifacialmocap')!;
  expect(phone.slots).toEqual(['face']);
  expect(phone.connect).toBe('askPhone');
  for(const id of ['selfreflect','vmc'])expect(TRACKING_PRESETS.find(p=>p.id===id)).toMatchObject({slots:['body','face','fingers'],connect:'showAddress'});
 });
 it('lists all nine steps in table order',()=>{
  for(const preset of TRACKING_PRESETS)expect(preset.steps).toEqual(ORDER);
  expect(Object.keys(EXPRESSION_STEPS).sort()).toEqual([...ORDER].sort());
 });
 it('names only ARKit channels',()=>{
  const names=new Set<string>(ARKIT_NAMES);
  for(const step of Object.values(EXPRESSION_STEPS)){
   expect(step.main.length).toBeGreaterThan(0);
   for(const name of [...step.main,...step.also])expect(names.has(name)).toBe(true);
  }
  expect(EXPRESSION_STEPS.lookAround.main).toHaveLength(8);
  expect(EXPRESSION_STEPS.lookAround.also).toEqual([]);
 });
});
