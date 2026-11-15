import {expect,it} from 'vitest';
import {addMenuEntries,addMenuItems} from '../src/editor/add-menu';
import {addLimitReached,makeAuthoringEntity} from '../src/editor/authoring';
it('shows FaceKit only on macOS',()=>{
 expect(addMenuItems('MacIntel').at(-1)).toEqual(['facekit','FaceKit Tracker']);
 for(const platform of ['Win32','Linux x86_64',''])expect(addMenuItems(platform).some(([kind])=>kind==='facekit')).toBe(false);
 expect(addMenuItems('MacIntel').slice(0,-1)).toEqual(addMenuItems('Win32'));
});
it('splits the add menu into scene, light, overlay, and tracking',()=>{
 const groups=addMenuEntries('MacIntel').map(entry=>entry.group);
 expect(groups).toEqual(['scene','scene','scene','scene','scene','light','light','light','light','light','overlay','tracking','tracking','tracking','tracking','tracking','tracking']);
 expect(addMenuEntries('Win32').at(-1)?.group).toBe('tracking');
});
it('stops the MediaPipe tracker at 4 tracking sources',()=>{
 expect(addMenuItems('MacIntel').some(([kind])=>kind==='mediapipe')).toBe(true);
 const sources=Array.from({length:4},(_,index)=>makeAuthoringEntity('mediapipe',`mp_${index}`,[]));
 expect(addLimitReached('mediapipe',sources)).toBe(true);
 expect(addLimitReached('mediapipe',sources.slice(0,3))).toBe(false);
});
