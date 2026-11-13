import {expect,it} from 'vitest';
import {parseCameraList,trackingStateLabel} from '../src/editor/facekit';
it('parses the host camera list',()=>{
 expect(parseCameraList([{deviceId:'a',label:'FaceTime HD Camera'},{deviceId:1,label:'x'},null,{deviceId:'b'.repeat(513),label:'y'},{deviceId:'',label:'z'}])).toEqual([{deviceId:'a',label:'FaceTime HD Camera'}]);
 expect(parseCameraList({})).toEqual([]);
});
it('labels the permission state',()=>{expect(trackingStateLabel('permissionNeeded')).toBe('permission needed');expect(trackingStateLabel('stale')).toBe('stale');});
