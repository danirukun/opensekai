import {expect,it} from 'vitest';
import {parseCameraList,trackingStateLabel} from '../src/editor/facekit';
it('parses the host camera list',()=>{
 expect(parseCameraList([{deviceId:'a',label:'FaceTime HD Camera'},{deviceId:1,label:'x'},null,{deviceId:'b'.repeat(513),label:'y'},{deviceId:'',label:'z'}])).toEqual([{deviceId:'a',label:'FaceTime HD Camera'}]);
 expect(parseCameraList({})).toEqual([]);
});
it('limits the host camera list like the browser list',()=>{
 expect(parseCameraList(Array.from({length:20},(_,index)=>({deviceId:`cam-${index}`,label:'Camera'})))).toHaveLength(16);
 expect(parseCameraList([{deviceId:'a',label:'x'.repeat(300)}])).toEqual([{deviceId:'a',label:'x'.repeat(128)}]);
});
it('labels the permission state',()=>{expect(trackingStateLabel('permissionNeeded')).toBe('permission needed');expect(trackingStateLabel('stale')).toBe('stale');});
