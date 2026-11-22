import {describe,it,expect} from 'vitest';
import {DEFAULT_CAMERA_EFFECTS,DEFAULT_CAMERA_LENS,type CameraEffects} from '@opensekai/contracts';
import {applyLensPreset,lensPresetOperations,LENS_PRESETS} from './lens-presets';
const lens={...DEFAULT_CAMERA_LENS,near:.02,far:50,focusDistance:4};
describe('lens presets',()=>{
 it('lists the named presets in table order',()=>{
  expect(LENS_PRESETS.map(preset=>preset.id)).toEqual(['default','portrait','wide','cinematic','concert']);
 });
 it('Default keeps a Full Frame 50mm f/4 lens with depth of field off',()=>{
  const result=applyLensPreset('default',lens);
  expect(result.lens).toMatchObject({focalLengthMm:50,fStop:4,autofocus:false,sensorPreset:'fullFrame'});
  expect(result.effects?.depthOfField.enabled).toBe(false);
  expect(result.grading).toBeUndefined();
 });
 it('Portrait opens the aperture, turns on autofocus, and switches depth of field on',()=>{
  const result=applyLensPreset('portrait',lens);
  expect(result.lens).toMatchObject({focalLengthMm:85,fStop:1.8,autofocus:true});
  expect(result.effects?.depthOfField.enabled).toBe(true);
 });
 it('Wide keeps depth of field off at 24mm f/2.8',()=>{
  const result=applyLensPreset('wide',lens);
  expect(result.lens).toMatchObject({focalLengthMm:24,fStop:2.8,autofocus:false});
  expect(result.effects?.depthOfField.enabled).toBe(false);
 });
 it('Cinematic is the one documented full look: mild grain, mild vignette, and ACES',()=>{
  const result=applyLensPreset('cinematic',lens);
  expect(result.lens).toMatchObject({focalLengthMm:35,fStop:2});
  expect(result.effects?.filmGrain.enabled).toBe(true);
  expect(result.effects?.vignetting.enabled).toBe(true);
  expect(result.grading?.toneMapping).toBe('aces');
 });
 it('Concert stays under a 35 degree vertical FOV and keeps the look stack off for performance',()=>{
  const loud:CameraEffects={...DEFAULT_CAMERA_EFFECTS,depthOfField:{...DEFAULT_CAMERA_EFFECTS.depthOfField,enabled:true},filmGrain:{...DEFAULT_CAMERA_EFFECTS.filmGrain,enabled:true}};
  const result=applyLensPreset('concert',lens,loud);
  expect(result.lens.fovDegrees).toBeLessThan(35);
  expect(result.effects?.depthOfField.enabled).toBe(false);
  expect(result.effects?.lensFlare.enabled).toBe(false);
  expect(result.effects?.anamorphicFlare.enabled).toBe(false);
  expect(result.effects?.filmGrain.enabled).toBe(false);
  expect(result.grading).toBeUndefined();
 });
 it('carries the focus distance and clip planes over from the current lens',()=>{
  const result=applyLensPreset('portrait',lens);
  expect(result.lens.focusDistance).toBe(lens.focusDistance);
  expect(result.lens.near).toBe(lens.near);
  expect(result.lens.far).toBe(lens.far);
 });
 it('builds one patch with lens, effects, and grading only when the preset sets them',()=>{
  expect(lensPresetOperations('cam',applyLensPreset('cinematic',lens)).map(op=>op.kind)).toEqual(['setCameraLens','setCameraEffects','setCameraGrading']);
  expect(lensPresetOperations('cam',applyLensPreset('wide',lens)).map(op=>op.kind)).toEqual(['setCameraLens','setCameraEffects']);
  expect(lensPresetOperations('cam',{lens})).toEqual([{kind:'setCameraLens',entityId:'cam',lens}]);
 });
 it('keeps an unrelated effect group, like lens dirt, as it was',()=>{
  const current:CameraEffects={...DEFAULT_CAMERA_EFFECTS,lensDirt:{assetId:'dirt_1',intensity:.6,threshold:.4}};
  const result=applyLensPreset('wide',lens,current);
  expect(result.effects?.lensDirt).toEqual(current.lensDirt);
 });
});
