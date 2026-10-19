import {it,expect} from 'vitest';
import {ScenePatchSchema,SceneViewSchema,TrackingCalibrationSchema,TrackingMappingSchema,DEFAULT_TRACKING_MAPPING,CALIBRATION_BONES,FINGER_BONES,ARKIT_NAMES} from '../src/index';
import fixture from '../../../fixtures/protocol/tracking-overrides.json';
const patch=(operation:unknown)=>ScenePatchSchema.safeParse({sceneId:'scene',expectedRevision:1,operations:[operation]}).success;
const neutral={rotation:[0,0,0,1],space:'normalized'};
const mapping=fixture.withFields.entities[3]!.mapping!;
it('round-trips the fixture scenes with and without the B6 fields unchanged',()=>{
 for(const scene of [fixture.withFields,fixture.withoutFields]){const parsed=SceneViewSchema.parse(scene);expect(JSON.parse(JSON.stringify(parsed))).toEqual(scene);}
 expect(JSON.stringify(SceneViewSchema.parse(fixture.withoutFields))).not.toContain('fingersSourceId');
});
it('accepts the three new operations and checks the calibration shape',()=>{
 expect(patch({kind:'calibrateTracking',entityId:'s'})).toBe(true);
 expect(patch({kind:'setTrackingCalibration',entityId:'s',calibration:null})).toBe(true);
 expect(patch({kind:'setTrackingMapping',entityId:'s',mapping:DEFAULT_TRACKING_MAPPING})).toBe(true);
 const all=Object.fromEntries(CALIBRATION_BONES.map(name=>[name,neutral]));
 expect(TrackingCalibrationSchema.safeParse({bones:all}).success).toBe(true);
 for(const bones of [{},{...all,leftEye:neutral},{leftEye:neutral},{head:{rotation:[0,0,0,2],space:'raw'}},{head:{...neutral,space:'world'}},{head:{...neutral,extra:1}}])expect(TrackingCalibrationSchema.safeParse({bones}).success,JSON.stringify(bones)).toBe(false);
});
it('checks each mapping limit',()=>{
 expect(TrackingMappingSchema.safeParse(mapping).success).toBe(true);
 expect(TrackingMappingSchema.safeParse({...mapping,headIntensity:2,eyeIntensity:0,headOffset:[-90,90,0],blendShapeSensitivity:3}).success).toBe(true);
 const range=(inputMin:number,inputMax:number,outputMin:number,outputMax:number)=>({jawOpen:{inputMin,inputMax,outputMin,outputMax}});
 for(const bad of [{headIntensity:2.01},{eyeIntensity:-.01},{headOffset:[0,91,0]},{blendShapeSensitivity:3.01},{blendShapes:range(.5,.5,0,1)},{blendShapes:range(0,1,.6,.5)},{blendShapes:range(0,1.1,0,1)},{blendShapes:{tail:{inputMin:0,inputMax:1,outputMin:0,outputMax:1}}},{linkedBlink:1}])
  expect(TrackingMappingSchema.safeParse({...mapping,...bad}).success,JSON.stringify(bad)).toBe(false);
 expect(TrackingMappingSchema.safeParse({...mapping,blendShapes:Object.fromEntries(ARKIT_NAMES.map(name=>[name,{inputMin:0,inputMax:1,outputMin:0,outputMax:1}]))}).success).toBe(true);
});
it('accepts a finger slot and rejects an iFacialMocap or missing finger source',()=>{
 expect(FINGER_BONES).toHaveLength(30);
 const withFingers=(id:string|null)=>({...fixture.withFields,entities:fixture.withFields.entities.map(entity=>entity.kind==='avatar'?{...entity,tracking:{...entity.tracking,fingersSourceId:id}}:entity)});
 expect(SceneViewSchema.safeParse(withFingers(null)).success).toBe(true);
 expect(SceneViewSchema.safeParse(withFingers('source_vmc')).success).toBe(true);
 expect(SceneViewSchema.safeParse(withFingers('source_face')).success).toBe(false);
 expect(SceneViewSchema.safeParse(withFingers('missing')).success).toBe(false);
});
