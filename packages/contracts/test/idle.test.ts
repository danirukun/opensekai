import {it,expect} from 'vitest';
import {SceneEntitySchema,ScenePatchSchema,AvatarPoseSchema,AssetAnimationSchema,AssetRecordSchema,AssetSummarySchema,makeSmokeScene} from '../src/index';
it('accepts optional built-in idle and its patch without changing legacy avatars',()=>{
 const avatar=makeSmokeScene().entities.find(e=>e.kind==='avatar')!;
 expect(SceneEntitySchema.safeParse(avatar).success).toBe(true);
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:{kind:'builtin',enabled:true}}).success).toBe(true);
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:{kind:'mixamo',enabled:true}}).success).toBe(false);
 expect(ScenePatchSchema.safeParse({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setAvatarIdle',entityId:avatar.id,idleAnimation:{kind:'builtin',enabled:false}}]}).success).toBe(true);
});
it('accepts clip idle with assetId and rejects a clip without assetId',()=>{
 const avatar=makeSmokeScene().entities.find(e=>e.kind==='avatar')!;
 const clip={kind:'clip' as const,enabled:true,assetId:'animation_abc'};
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:clip}).success).toBe(true);
 expect(ScenePatchSchema.safeParse({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setAvatarIdle',entityId:avatar.id,idleAnimation:clip}]}).success).toBe(true);
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:{kind:'clip',enabled:true}}).success).toBe(false);
 expect(SceneEntitySchema.safeParse({...avatar,idleAnimation:{kind:'clip',enabled:true,assetId:''}}).success).toBe(false);
});
it('accepts AssetAnimation bounds and animation asset records',()=>{
 const track={times:[0,1],rotations:[0,0,0,1,0,0,0,1]};
 expect(AssetAnimationSchema.safeParse({durationMs:1000,bones:{chest:track}}).success).toBe(true);
 expect(AssetAnimationSchema.safeParse({durationMs:0,bones:{chest:track}}).success).toBe(false);
 expect(AssetAnimationSchema.safeParse({durationMs:1000,bones:{}}).success).toBe(false);
 expect(AssetAnimationSchema.safeParse({durationMs:1000,bones:{chest:{times:[0],rotations:[0,0,0,1,0]}}}).success).toBe(false);
 expect(AssetSummarySchema.safeParse({id:'animation_a',kind:'animation',name:'Idle'}).success).toBe(true);
 const record={
  id:'animation_'+'a'.repeat(64),format:'vrma' as const,sha256:'a'.repeat(64),bytes:128,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1 as const,name:'Idle',expressions:[],
  animation:{durationMs:1000,bones:{chest:track}},
 };
 expect(AssetRecordSchema.safeParse(record).success).toBe(true);
 expect(AssetRecordSchema.safeParse({...record,format:'fbx' as const}).success).toBe(true);
 expect(AssetRecordSchema.safeParse({...record,id:'avatar_'+'a'.repeat(64)}).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,animation:undefined}).success).toBe(false);
});
it('accepts only normalized unweighted idle baseline bones',()=>{
 const pose={avatarId:'a',bones:{},expressions:{}};
 expect(AvatarPoseSchema.safeParse(pose).success).toBe(true);
 const bone={space:'normalized',rotation:[0,0,0,1]};
 expect(AvatarPoseSchema.safeParse({...pose,baseBones:{chest:bone}}).success).toBe(true);
 for(const bad of [{...bone,space:'raw'},{...bone,weight:.5},{...bone,weight:null},{...bone,rotation:[0,0,0,0]}])expect(AvatarPoseSchema.safeParse({...pose,baseBones:{chest:bad}}).success).toBe(false);
});
