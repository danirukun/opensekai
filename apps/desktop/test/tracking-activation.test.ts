import {it,expect,vi} from 'vitest';
import {applyTrackingConfig} from '../src/editor/tracking-activation';
import {defaultTrackingConfig,type TrackingConfig} from '@opensekai/contracts';
const success={ok:true as const,data:{revision:2}};
it('activates the camera owner before committing enabled MediaPipe with the captured revision',async()=>{
 const order:string[]=[];const activate=vi.fn(async()=>{order.push('activate');}),commit=vi.fn(async()=>{order.push('commit');return success;});
 const config={...defaultTrackingConfig('mediapipe'),enabled:true};
 expect(await applyTrackingConfig('tracker',config,1,{activate,commit})).toEqual(success);
 expect(order).toEqual(['activate','commit']);expect(commit).toHaveBeenCalledWith('tracker',config,1);
});
it('does not change focus for Stop or a network receiver',async()=>{
 for(const config of [defaultTrackingConfig('mediapipe'),{...defaultTrackingConfig('vmc'),enabled:true}]){const activate=vi.fn(),commit=vi.fn().mockResolvedValue(success);await applyTrackingConfig('tracker',config,1,{activate,commit});expect(activate).not.toHaveBeenCalled();expect(commit).toHaveBeenCalledOnce();}
});
it('does not enable tracking when camera-owner activation fails',async()=>{
 const activate=vi.fn().mockRejectedValue(new Error('native unavailable')),commit=vi.fn();
 const reply=await applyTrackingConfig('tracker',{...defaultTrackingConfig('mediapipe'),enabled:true},1,{activate,commit});
 expect(reply).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(commit).not.toHaveBeenCalled();
});
it('rejects invalid configuration before requesting activation',async()=>{
 const activate=vi.fn(),commit=vi.fn();const config={kind:'mediapipe',enabled:true,deviceId:'',face:false,upperBody:false,hands:false,mirror:false} as TrackingConfig;
 expect(await applyTrackingConfig('tracker',config,1,{activate,commit})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(activate).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();
});
