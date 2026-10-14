import {expect,it} from 'vitest';
import type {SceneEntity} from '@opensekai/contracts';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {groupEntities} from '../src/editor/asset-groups';
const camera=(id:string)=>makeAuthoringEntity('camera',id,[]);
const tracking=(kind:'vmc'|'ifacialmocap'|'mediapipe',id:string)=>makeAuthoringEntity(kind,id,[]);
it('groups stable asset types and preserves scene order inside each group',()=>{
 const base=camera('base');
 const avatar={...base,id:'avatar',kind:'avatar',assetId:'avatar_asset'} as SceneEntity;
 const prop={...base,id:'prop',kind:'mesh',source:{kind:'box'}} as SceneEntity;
 const entities=[tracking('mediapipe','mp'),camera('second'),prop,tracking('vmc','v'),avatar,camera('first'),tracking('ifacialmocap','i')];
 expect(groupEntities(entities).map(group=>[group.key,group.entities.map(entity=>entity.id)])).toEqual([['camera',['second','first']],['avatar',['avatar']],['mesh',['prop']],['vmc',['v']],['ifacialmocap',['i']],['mediapipe',['mp']]]);
});
it('omits empty groups and retains hidden matches in case-insensitive search',()=>{
 const hidden={...camera('hidden'),name:'Side Camera',visible:false};
 expect(groupEntities([tracking('vmc','v'),hidden],' SIDE ').map(group=>group.entities)).toEqual([[hidden]]);
 expect(groupEntities([hidden],'absent')).toEqual([]);
 expect(groupEntities([])).toEqual([]);
});
it('puts the environment group before cameras',()=>{
 const stage=makeAuthoringEntity('environment','stage',[]);
 expect(groupEntities([camera('c'),stage]).map(group=>group.key)).toEqual(['environment','camera']);
});
