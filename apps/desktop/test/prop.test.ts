import {expect,it} from 'vitest';
import {makeSmokeScene,type SceneEntity} from '@opensekai/contracts';
import {addLimitReached,makeAuthoringEntity} from '../src/editor/authoring';
import {sectionsFor} from '../src/editor/inspector-sections';
it('creates a prop without a model and disables Prop only at the 64-entity limit (R6)',()=>{
 const scene=makeSmokeScene().entities;
 expect(makeAuthoringEntity('prop','p',scene)).toEqual({id:'p',name:'Prop',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'mesh',source:{kind:'asset',assetId:null}});
 const many:SceneEntity[]=[...scene];
 while(many.length<63)many.push(makeAuthoringEntity('prop',`p${many.length}`,many));
 expect(addLimitReached('prop',many)).toBe(false);
 many.push(makeAuthoringEntity('prop','last',many));
 expect(addLimitReached('prop',many)).toBe(true);
});
it('gives a prop a Prop section and a box mesh only a Transform (R7)',()=>{
 const prop=makeAuthoringEntity('prop','p',[]);
 expect(sectionsFor(prop,{expressions:false}).map(section=>section.label)).toEqual(['Transform','Prop']);
 expect(sectionsFor({...prop,source:{kind:'box'}},{expressions:false}).map(section=>section.label)).toEqual(['Transform']);
});
