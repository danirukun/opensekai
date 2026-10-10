import {it,expect} from 'vitest';
import {makeSmokeScene} from '@opensekai/contracts';
import {createSession} from '../src/session';
const patch=(revision:number,operations:unknown[])=>({sceneId:'scene_smoke',expectedRevision:revision,operations} as never);
it('sets, replaces, and clears an avatar model atomically',()=>{
 const s=createSession(makeSmokeScene(),'model-test');
 expect(s.applyPatch(patch(0,[{kind:'setAvatarModel',entityId:'performer',assetId:'avatar_b'}])).ok).toBe(true);
 expect(s.inspect().entities.find(e=>e.id==='performer')).toMatchObject({assetId:'avatar_b'});
 expect(s.applyPatch(patch(1,[{kind:'setAvatarModel',entityId:'performer',assetId:null}])).ok).toBe(true);
 expect(s.inspect().entities.find(e=>e.id==='performer')).toMatchObject({assetId:null});
});
it('rejects a non-avatar or unknown entity and keeps the scene',()=>{
 const s=createSession(makeSmokeScene(),'model-test');const before=s.inspect();
 expect(s.applyPatch(patch(0,[{kind:'setVisibility',entityId:'performer',visible:false},{kind:'setAvatarModel',entityId:'marker',assetId:'avatar_b'}]))).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(s.applyPatch(patch(0,[{kind:'setAvatarModel',entityId:'nobody',assetId:null}]))).toMatchObject({ok:false,error:{code:'NOT_FOUND'}});
 expect(s.inspect()).toEqual(before);
});
