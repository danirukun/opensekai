import {it,expect} from 'vitest';
import {makeSmokeScene} from '@opensekai/contracts';
import {createSession} from '../src/session';
it('sets avatar idle atomically and rejects non-avatar changes',()=>{
 const s=createSession(makeSmokeScene(),'idle-test');
 expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setAvatarIdle',entityId:'performer',idleAnimation:{kind:'builtin',enabled:true}}]}).ok).toBe(true);
 expect(s.inspect().entities.find(e=>e.kind==='avatar')).toMatchObject({idleAnimation:{enabled:true}});
 const before=s.inspect();expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:1,operations:[{kind:'setVisibility',entityId:'performer',visible:false},{kind:'setAvatarIdle',entityId:'marker',idleAnimation:{kind:'builtin',enabled:true}}]}).ok).toBe(false);
 expect(s.inspect()).toEqual(before);
});
