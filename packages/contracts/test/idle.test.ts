import {it,expect} from 'vitest';
import {SceneEntitySchema,ScenePatchSchema,AvatarPoseSchema,makeSmokeScene} from '../src/index';
it('accepts optional built-in idle and its patch without changing legacy avatars',()=>{
 const avatar=makeSmokeScene().entities.find(e=>e.kind==='avatar')!;
 expect(SceneEntitySchema.safeParse(avatar).success).toBe(true);
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:{kind:'builtin',enabled:true}}).success).toBe(true);
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:{kind:'mixamo',enabled:true}}).success).toBe(false);
 expect(ScenePatchSchema.safeParse({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setAvatarIdle',entityId:avatar.id,idleAnimation:{kind:'builtin',enabled:false}}]}).success).toBe(true);
});
it('accepts only normalized unweighted idle baseline bones',()=>{
 const pose={avatarId:'a',bones:{},expressions:{}};
 expect(AvatarPoseSchema.safeParse(pose).success).toBe(true);
 const bone={space:'normalized',rotation:[0,0,0,1]};
 expect(AvatarPoseSchema.safeParse({...pose,baseBones:{chest:bone}}).success).toBe(true);
 for(const bad of [{...bone,space:'raw'},{...bone,weight:.5},{...bone,weight:null},{...bone,rotation:[0,0,0,0]}])expect(AvatarPoseSchema.safeParse({...pose,baseBones:{chest:bad}}).success).toBe(false);
});
