import {expect,it} from 'vitest';
import {addMenuItems} from '../src/editor/add-menu';
it('shows FaceKit only on macOS',()=>{
 expect(addMenuItems('MacIntel').at(-1)).toEqual(['facekit','FaceKit Tracker']);
 for(const platform of ['Win32','Linux x86_64',''])expect(addMenuItems(platform).some(([kind])=>kind==='facekit')).toBe(false);
 expect(addMenuItems('MacIntel').slice(0,-1)).toEqual(addMenuItems('Win32'));
});
