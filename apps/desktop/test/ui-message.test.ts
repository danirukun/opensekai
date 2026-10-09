import type {ConnectionDescriptor} from '@opensekai/contracts';
import {makeOutputUrl} from '../src/editor/output-url';
import {expect,it,vi} from 'vitest';
import {createDraftSender,fitPreview,parseUIMessage,type Draft} from '../src/editor/ui-message';
const draft:Exclude<Draft,null>={entityId:'performer',transform:{position:[1,2,3],rotation:[0,0,0,1],scale:[1,1,1]}};
it('accepts only bounded UI state, with finite positive transforms and no connection fields',()=>{
 expect(parseUIMessage({kind:'tool',tool:'rotate'})).toEqual({kind:'tool',tool:'rotate'});
 expect(parseUIMessage({kind:'draft',draft})).toEqual({kind:'draft',draft});
 expect(parseUIMessage({kind:'selection',entityId:'a'.repeat(257)})).toBeNull();
 expect(parseUIMessage({kind:'ready',ticket:'secret'})).toBeNull();
 expect(parseUIMessage({kind:'draft',draft:{...draft,transform:{...draft.transform,scale:[0,1,1]}}})).toBeNull();
 expect(parseUIMessage({kind:'draft',draft:{...draft,transform:{...draft.transform,position:[Infinity,0,0]}}})).toBeNull();
});
it('coalesces drafts at 20Hz with one active send and cancels unsent work on close',async()=>{
 vi.useFakeTimers();let resolve!:()=>void;const send=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));const sender=createDraftSender(send);
 sender.offer(null);sender.offer(structuredClone(draft));await vi.advanceTimersByTimeAsync(49);expect(send).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(send).toHaveBeenCalledTimes(1);
 sender.offer(structuredClone(draft));sender.offer(null);await vi.advanceTimersByTimeAsync(100);expect(send).toHaveBeenCalledTimes(1);resolve();await vi.advanceTimersByTimeAsync(50);expect(send).toHaveBeenLastCalledWith({kind:'draft',draft:null});sender.offer(structuredClone(draft));sender.close();resolve();await vi.advanceTimersByTimeAsync(100);expect(send).toHaveBeenCalledTimes(2);vi.useRealTimers();
});
it('fits the preview canvas without letterboxing inside its pointer hit rectangle',()=>{expect(fitPreview(800,300)).toEqual({width:300*16/9,height:300});expect(fitPreview(320,600)).toEqual({width:320,height:180});});

it('preserves the selected output backend in copied URLs from either window',()=>{
 const descriptor={httpOrigin:'http://127.0.0.1:1234',ticket:'test-only'} as ConnectionDescriptor;
 const forced=new URL(makeOutputUrl(descriptor,'force-webgl2'));expect(forced.searchParams.get('backend')).toBe('webgl2');expect(forced.searchParams.has('diagnostics')).toBe(false);expect(JSON.parse(decodeURIComponent(forced.hash.slice(1)))).toEqual(descriptor);
 const automatic=new URL(makeOutputUrl(descriptor,'auto'));expect(automatic.searchParams.has('backend')).toBe(false);expect(automatic.searchParams.has('diagnostics')).toBe(false);
});

it('passes only bounded device choices to the editor without camera frames or privileged fields',()=>{
 const message={kind:'trackingDevices',devices:[{deviceId:'local-camera',label:'Camera'}]};expect(parseUIMessage(message)).toEqual(message);
 for(const devices of [[{deviceId:'camera',label:'Camera',frame:[]}],[{deviceId:'a'.repeat(513),label:'Camera'}],Array.from({length:9},()=>({deviceId:'a',label:'a'}))])expect(parseUIMessage({kind:'trackingDevices',devices})).toBeNull();
});

it('fits the camera frame inside its margin and clamps collapsed stages',()=>{expect(fitPreview(800,300,24)).toEqual({width:448,height:252});expect(fitPreview(320,600,24)).toEqual({width:272,height:153});expect(fitPreview(20,20,24)).toEqual({width:0,height:0});expect(fitPreview(800,0,24)).toEqual({width:0,height:0});});

it('accepts bounded load status and rejects malformed entries',()=>{
 const ok={entityId:'char',assetId:'avatar_a',stage:'textures',progress:.5,count:{done:12,total:24}};
 expect(parseUIMessage({kind:'loadStatus',entries:[ok]})).toEqual({kind:'loadStatus',entries:[ok]});
 const failed={entityId:'char',assetId:'avatar_a',stage:'failed',progress:null,message:'Asset unavailable'};
 expect(parseUIMessage({kind:'loadStatus',entries:[failed]})).toEqual({kind:'loadStatus',entries:[failed]});
 expect(parseUIMessage({kind:'loadStatus',entries:Array(9).fill(ok)})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,progress:2}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,stage:'parse'}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,extra:1}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,count:{done:25,total:24}}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...ok,count:{done:1,total:1025}}]})).toBeNull();
 expect(parseUIMessage({kind:'loadStatus',entries:[{...failed,message:'x'.repeat(161)}]})).toBeNull();
 const {progress:_,...noProgress}=ok;
 expect(parseUIMessage({kind:'loadStatus',entries:[noProgress]})).toBeNull();
});
