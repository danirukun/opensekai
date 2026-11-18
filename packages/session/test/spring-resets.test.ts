import {expect,it} from 'vitest';
import {makeSmokeScene,type Quat,type Vec3} from '@opensekai/contracts';
import {avatarRoot,isTeleport,advanceSpringResets} from '../src/spring-resets';
import {createSession} from '../src/session';
const at=(x:number,yawDeg=0,scale=1)=>({position:[x,0,0] as Vec3,rotation:[0,Math.sin(yawDeg*Math.PI/360),0,Math.cos(yawDeg*Math.PI/360)] as Quat,scale});
// B43 R4: strictly more than each limit is a teleport.
it('finds a teleport only above each limit',()=>{
 expect(isTeleport(at(0),at(.099))).toBe(false);expect(isTeleport(at(0),at(.101))).toBe(true);
 expect(isTeleport(at(0),at(0,29))).toBe(false);expect(isTeleport(at(0),at(0,31))).toBe(true);
 expect(isTeleport(at(0,0,1),at(0,0,1.24))).toBe(false);expect(isTeleport(at(0,0,1.25),at(0,0,.99))).toBe(true);
});
// B43 R3: the entity transform times pose.root.
it('puts the pose root in the entity frame',()=>{
 const root=avatarRoot({position:[1,0,0],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,2,2]},{position:[1,0,0],rotation:[0,0,0,1]});
 expect(root.position[0]).toBeCloseTo(1);expect(root.position[2]).toBeCloseTo(-2);expect(root.scale).toBe(2);
});
it('counts a teleport of the performer and keeps the count on later frames',()=>{
 const s=createSession(makeSmokeScene(),'springs');
 expect(s.advance(0).springResets).toBeUndefined();
 const t=s.inspect().entities.find(e=>e.id==='performer')!.transform;
 expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setTransform',entityId:'performer',transform:{...t,position:[t.position[0]+1,t.position[1],t.position[2]]}}]} as never).ok).toBe(true);
 expect(s.advance(17).springResets).toEqual([{avatarId:'performer',count:1}]);
 expect(s.advance(34).springResets).toEqual([{avatarId:'performer',count:1}]);
});
const scene=(x:number,assetId='fixture_vrm_1',second?:number)=>{const s=makeSmokeScene();const p=s.entities.find(e=>e.id==='performer')!;Object.assign(p,{assetId,transform:{...p.transform,position:[x,0,0]}});
 if(second!==undefined)s.entities.push({...structuredClone(p),id:'guest',transform:{...p.transform,position:[second,0,0]}});return s;};
// B43 R5: a new avatar and a changed asset start without a previous value; the count stays.
it('does not count a model change or a new avatar as a teleport, and keeps the count',()=>{
 let r=advanceSpringResets(new Map(),scene(0),[]);expect(r.resets).toEqual([]);
 r=advanceSpringResets(r.state,scene(1),[]);expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
 r=advanceSpringResets(r.state,scene(3,'avatar_b'),[]);expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
 r=advanceSpringResets(r.state,scene(3,'avatar_b',5),[]);expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
 expect(r.state.has('guest')).toBe(true);
 r=advanceSpringResets(r.state,scene(3,'avatar_b'),[]);expect(r.state.has('guest')).toBe(false);
});
it('uses the pose root of the avatar',()=>{
 let r=advanceSpringResets(new Map(),scene(0),[{avatarId:'performer',bones:{},expressions:{},root:{position:[0,0,0],rotation:[0,0,0,1]}}]);
 r=advanceSpringResets(r.state,scene(0),[{avatarId:'performer',bones:{},expressions:{},root:{position:[0,0,.5],rotation:[0,0,0,1]}}]);
 expect(r.resets).toEqual([{avatarId:'performer',count:1}]);
});
