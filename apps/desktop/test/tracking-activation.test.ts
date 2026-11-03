import {it,expect,vi} from 'vitest';
import {applyTrackingConfig} from '../src/editor/tracking-activation';
import {defaultTrackingConfig,type TrackingConfig} from '@opensekai/contracts';
const success={ok:true as const,data:{revision:2}};
it('commits enabled MediaPipe with the captured revision',async()=>{
 const commit=vi.fn(async()=>success);
 const config={...defaultTrackingConfig('mediapipe'),enabled:true};
 expect(await applyTrackingConfig('tracker',config,1,{commit})).toEqual(success);
 expect(commit).toHaveBeenCalledOnce();expect(commit).toHaveBeenCalledWith('tracker',config,1);
});
it('rejects invalid configuration before it commits',async()=>{
 const commit=vi.fn();const config={kind:'mediapipe',enabled:true,deviceId:'',face:false,upperBody:false,hands:false,mirror:false} as TrackingConfig;
 expect(await applyTrackingConfig('tracker',config,1,{commit})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});expect(commit).not.toHaveBeenCalled();
});
