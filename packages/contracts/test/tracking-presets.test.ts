import {describe,expect,it} from 'vitest';
import {ARKIT_NAMES,DEFAULT_TRACKING_SMOOTHING,EXPRESSION_STEPS,TRACKING_PRESETS,TrackingConfigSchema,TrackingSmoothingSchema,defaultTrackingConfig} from '../src';

const ORDER=['blink','mouthWide','browsUp','smile','frown','pucker','puffCheeks','tongueOut','lookAround'];
const preset=(id:string)=>TRACKING_PRESETS.find(p=>p.id===id)!;
const UDP=['selfreflect','ifacialmocap','vmc'];

describe('tracking presets',()=>{
 it('lists SelfReflect, iFacialMocap, Other VMC app, then Webcam, OpenSeeFace, FaceKit',()=>{
  expect(TRACKING_PRESETS.map(p=>[p.id,p.label])).toEqual([['selfreflect','SelfReflect'],['ifacialmocap','iFacialMocap'],['vmc','Other VMC app'],['webcam','Webcam'],['openseeface','OpenSeeFace'],['facekit','FaceKit']]);
 });
 it('has valid enabled configs; the phone and VMC presets bind to all interfaces',()=>{
  for(const p of TRACKING_PRESETS){
   expect(TrackingConfigSchema.safeParse(p.config).success).toBe(true);
   expect(p.config.enabled).toBe(true);
  }
  for(const id of UDP)expect(preset(id).config).toMatchObject({bindAddress:'0.0.0.0'});
  expect(UDP.map(id=>[preset(id).config.kind,(preset(id).config as {port:number}).port])).toEqual([['vmc',39539],['ifacialmocap',49983],['vmc',39539]]);
 });
 it('uses the default smoothing',()=>{
  for(const p of TRACKING_PRESETS){
   expect(TrackingSmoothingSchema.safeParse(p.smoothing).success).toBe(true);
   expect(p.smoothing).toEqual(DEFAULT_TRACKING_SMOOTHING);
  }
 });
 it('SelfReflect drops the VMC bone positions; the other presets keep the default',()=>{
  expect(preset('selfreflect').config).toMatchObject({kind:'vmc',positions:'rotationsOnly'});
  expect('positions' in preset('vmc').config).toBe(false);
  expect('positions' in preset('ifacialmocap').config).toBe(false);
 });
 it('accepts only the three position rules on a VMC config',()=>{
  const vmc={kind:'vmc',enabled:true,bindAddress:'0.0.0.0',port:39539,senderAddress:null};
  for(const positions of ['all','rotationsOnly','hipsOnly'])expect(TrackingConfigSchema.safeParse({...vmc,positions}).success).toBe(true);
  expect(TrackingConfigSchema.safeParse({...vmc,positions:'none'}).success).toBe(false);
  expect(TrackingConfigSchema.safeParse({kind:'ifacialmocap',enabled:true,bindAddress:'0.0.0.0',port:49983,phoneAddress:null,positions:'all'}).success).toBe(false);
 });
 it('fills the face slot only for iFacialMocap and asks for the phone',()=>{
  expect(preset('ifacialmocap').slots).toEqual(['face']);
  expect(preset('ifacialmocap').connect).toBe('askPhone');
  for(const id of ['selfreflect','vmc'])expect(preset(id)).toMatchObject({slots:['body','face','fingers'],connect:'showAddress'});
 });
 it('Webcam is a MediaPipe tracker for the body, face, and fingers with a camera choice',()=>{
  expect(preset('webcam')).toMatchObject({slots:['body','face','fingers'],connect:'pickCamera',calibrate:true});
  expect(preset('webcam').config).toEqual({kind:'mediapipe',enabled:true,deviceId:'',face:true,upperBody:true,hands:true,mirror:false});
 });
 it('OpenSeeFace fills the face slot and shows the local endpoint 127.0.0.1:11573',()=>{
  expect(preset('openseeface')).toMatchObject({slots:['face'],connect:'showAddress',calibrate:true});
  expect(preset('openseeface').config).toEqual({...defaultTrackingConfig('openseeface'),enabled:true});
  expect(preset('openseeface').config).toMatchObject({bindAddress:'127.0.0.1',port:11573});
 });
 it('FaceKit fills the face slot with a host camera choice',()=>{
  expect(preset('facekit')).toMatchObject({slots:['face'],connect:'pickHostCamera',calibrate:true});
  expect(preset('facekit').config).toEqual({kind:'facekit',enabled:true,deviceId:''});
 });
 it('calibrates every preset except the VMC presets, whose sender calibrates',()=>{
  expect(Object.fromEntries(TRACKING_PRESETS.map(p=>[p.id,p.calibrate]))).toEqual({selfreflect:false,ifacialmocap:true,vmc:false,webcam:true,openseeface:true,facekit:true});
 });
 it('lists all nine steps in table order',()=>{
  for(const p of TRACKING_PRESETS)expect(p.steps).toEqual(ORDER);
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
