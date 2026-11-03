import type {ConnectionDescriptor} from '@opensekai/contracts';
import {makeOutputUrl} from '../src/editor/output-url';
import {expect,it} from 'vitest';
import {fitPreview} from '../src/editor/ui-message';
it('fits the preview canvas without letterboxing inside its pointer hit rectangle',()=>{expect(fitPreview(800,300)).toEqual({width:300*16/9,height:300});expect(fitPreview(320,600)).toEqual({width:320,height:180});});

it('preserves the selected output backend in copied URLs',()=>{
 const descriptor={httpOrigin:'http://127.0.0.1:1234',ticket:'test-only'} as ConnectionDescriptor;
 const forced=new URL(makeOutputUrl(descriptor,'force-webgl2'));expect(forced.searchParams.get('backend')).toBe('webgl2');expect(forced.searchParams.has('diagnostics')).toBe(false);expect(JSON.parse(decodeURIComponent(forced.hash.slice(1)))).toEqual(descriptor);
 const automatic=new URL(makeOutputUrl(descriptor,'auto'));expect(automatic.searchParams.has('backend')).toBe(false);expect(automatic.searchParams.has('diagnostics')).toBe(false);
});

it('fits the camera frame inside its margin and clamps collapsed stages',()=>{expect(fitPreview(800,300,24)).toEqual({width:448,height:252});expect(fitPreview(320,600,24)).toEqual({width:272,height:153});expect(fitPreview(20,20,24)).toEqual({width:0,height:0});expect(fitPreview(800,0,24)).toEqual({width:0,height:0});});
