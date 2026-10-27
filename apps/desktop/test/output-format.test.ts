import {expect,it,vi} from 'vitest';
import {makeSmokeScene,OUTPUT_SIZES,type AppApi,type ConnectionDescriptor} from '@opensekai/contracts';
import {createSession} from '@opensekai/session';
import {createEditorModel} from '../src/editor/model';
import {makeOutputUrl,withObsLayer,withQualityProfile} from '../src/editor/output-url';
import {changedFormat,formatField,frameLimitOptions,outputFormat,outputSizeOptions,renderScaleOptions} from '../src/editor/output-format';

const descriptor={httpOrigin:'http://127.0.0.1:1234',ticket:'test-only'} as ConnectionDescriptor;

it('adds the OBS layer parameters for each preset after the quality parameter and keeps the hash (B22 R13)',()=>{
 const base=makeOutputUrl(descriptor,'auto');
 for(const size of OUTPUT_SIZES){
  const url=new URL(withObsLayer(withQualityProfile(base,'performance_v1'),size));
  expect([...url.searchParams.keys()]).toEqual(['quality','layer-name','layer-width','layer-height']);
  expect(url.searchParams.get('layer-name')).toBe('OpenSekai');
  expect(url.searchParams.get('layer-width')).toBe(String(size.width));
  expect(url.searchParams.get('layer-height')).toBe(String(size.height));
  expect(JSON.parse(decodeURIComponent(url.hash.slice(1)))).toEqual(descriptor);
 }
 expect(withObsLayer('',OUTPUT_SIZES[0])).toBe('');
 expect(withObsLayer(base,undefined)).toBe(base);
});
it('lists the formats in the order of the panel and changes one field at a time (B22 R11)',()=>{
 expect(outputSizeOptions.map(option=>option.label)).toEqual(['1920 × 1080','1600 × 900','1280 × 720','960 × 540']);
 expect(renderScaleOptions.map(option=>option.label)).toEqual(['100%','75%','50%']);
 expect(frameLimitOptions.map(option=>option.label)).toEqual(['60 FPS','30 FPS']);
 const current=outputFormat(makeSmokeScene().outputs.find(output=>output.id==='output_main'));
 expect(current).toEqual({width:1920,height:1080,fps:60,renderScale:1});
 expect(changedFormat(current,'size','1280x720')).toEqual({width:1280,height:720,fps:60,renderScale:1});
 expect(changedFormat(current,'fps','30')).toEqual({width:1920,height:1080,fps:30,renderScale:1});
 expect(changedFormat(current,'renderScale','0.75')).toEqual({width:1920,height:1080,fps:60,renderScale:0.75});
 expect(changedFormat(current,'size','3840x2160')).toBeNull();
 expect(changedFormat(current,'fps','24')).toBeNull();
 expect(formatField(current,'size')).toBe('1920x1080');
});
it('sends one setOutputFormat for output_main and refuses a bad format before the call (B22 R11)',async()=>{
 const session=createSession(makeSmokeScene(),'output-editor');
 const scenePatch=vi.fn(async params=>session.applyPatch(params));
 const unsupported=vi.fn(async()=>({ok:false as const,error:{code:'UNSUPPORTED' as const,message:'',ids:[]}}));
 const api={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:session.inspect()})),scenePatch} as unknown as AppApi;
 const model=createEditorModel(api);
 await model.load();
 expect(await model.setOutputFormat({width:1280,height:720,fps:30,renderScale:0.75})).toMatchObject({ok:true});
 expect(scenePatch).toHaveBeenCalledTimes(1);
 expect(scenePatch.mock.calls[0][0].operations).toEqual([{kind:'setOutputFormat',outputId:'output_main',width:1280,height:720,fps:30,renderScale:0.75}]);
 expect(model.read().scene?.outputs.find(output=>output.id==='output_main')).toMatchObject({width:1280,height:720,fps:30,renderScale:0.75});
 expect(await model.setOutputFormat({width:3840,height:2160,fps:60,renderScale:1})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(scenePatch).toHaveBeenCalledTimes(1);
});
