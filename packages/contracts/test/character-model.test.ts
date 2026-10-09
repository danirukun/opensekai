import {it,expect} from 'vitest';
import {SceneViewSchema,ScenePatchSchema,AssetRecordSchema} from '../src/index';
const transform={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
const scene=(avatar:Record<string,unknown>)=>({schemaVersion:1,sceneId:'s',revision:0,outputs:[{id:'output_main',cameraId:'cam',width:1920,height:1080,fps:60}],entities:[
 {id:'cam',name:'Camera',visible:true,transform,kind:'camera',lens:{fovDegrees:40,near:.01,far:100}},
 {id:'char',name:'Character',visible:true,transform,kind:'avatar',...avatar}]});
const record={id:'avatar_x',format:'vrm',sha256:'a'.repeat(64),bytes:1,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name:'Rem'};
it('accepts a character with no model and keeps assetId required',()=>{
 expect(SceneViewSchema.safeParse(scene({assetId:null})).success).toBe(true);
 expect(SceneViewSchema.safeParse(scene({assetId:'avatar_x'})).success).toBe(true);
 expect(SceneViewSchema.safeParse(scene({})).success).toBe(false);
});
it('accepts setAvatarModel with an asset or null and rejects a missing assetId',()=>{
 const patch=(op:Record<string,unknown>)=>ScenePatchSchema.safeParse({sceneId:'s',expectedRevision:0,operations:[{kind:'setAvatarModel',entityId:'char',...op}]}).success;
 expect(patch({assetId:'avatar_x'})).toBe(true);
 expect(patch({assetId:null})).toBe(true);
 expect(patch({})).toBe(false);
});
it('requires a bounded asset name',()=>{
 expect(AssetRecordSchema.safeParse(record).success).toBe(true);
 const {name:_,...unnamed}=record;
 expect(AssetRecordSchema.safeParse(unnamed).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,name:''}).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,name:'a'.repeat(129)}).success).toBe(false);
 expect(AssetRecordSchema.safeParse({...record,name:'a'.repeat(128)}).success).toBe(true);
});
