import {expect,it} from 'vitest';
import {defaultTrackingConfig,makeSmokeScene,type PatchOp,type SceneEntity} from '@opensekai/contracts';
import {createSession} from '../src/session';
const setup=()=>createSession(makeSmokeScene(),'test');
const edit=(s:ReturnType<typeof setup>,operations:PatchOp[],revision=s.inspect().revision)=>s.applyPatch({sceneId:'scene_smoke',expectedRevision:revision,operations});
it('renames with a trimmed name and removes an entity from evaluated state',()=>{
 const s=setup();expect(edit(s,[{kind:'renameEntity',entityId:'marker',name:' Stage '}])).toEqual({ok:true,data:{revision:1}});
 expect(s.inspect().entities.find(e=>e.id==='marker')?.name).toBe('Stage');
 expect(edit(s,[{kind:'removeEntity',entityId:'marker'}]).ok).toBe(true);
 expect(s.advance(0).scene.entities.some(e=>e.id==='marker')).toBe(false);
});
it('clears all source assignments atomically and rejects late samples after removal',()=>{
 const scene=makeSmokeScene(),avatar=scene.entities.find(e=>e.kind==='avatar')!;
 const config=defaultTrackingConfig('vmc');config.enabled=true;
 scene.entities.push({id:'source',name:'Source',visible:true,transform:structuredClone(avatar.transform),kind:'tracking',generation:0,config} as SceneEntity);
 if(avatar.kind==='avatar')avatar.tracking={bodySourceId:'source',faceSourceId:'source'};
 scene.entities.push({...structuredClone(avatar),id:'performer2'});
 const s=createSession(scene,'test');s.ingestTracking({samples:[{sourceId:'source',generation:0,receivedAtMs:10,bones:{},expressions:{jawOpen:1}}],statuses:[]});
 expect(edit(s,[{kind:'removeEntity',entityId:'source'}]).ok).toBe(true);
 expect(s.inspect().entities.filter(e=>e.kind==='avatar').every(e=>e.tracking?.bodySourceId===null&&e.tracking?.faceSourceId===null)).toBe(true);
 s.ingestTracking({samples:[{sourceId:'source',generation:0,receivedAtMs:11,bones:{},expressions:{jawOpen:1}}],statuses:[]});
 expect(s.advance(0,11).trackingStatus??[]).toHaveLength(0);
 expect(s.advance(1,12).avatarPoses?.every(p=>!p.expressions.jawOpen)??true).toBe(true);
});
it('protects referenced cameras and rejects invalid/stale edits with no partial commit',()=>{
 const s=setup(),before=s.inspect();
 for(const ops of [[{kind:'renameEntity',entityId:'marker',name:'changed'},{kind:'removeEntity',entityId:'camera_wide'}],[{kind:'renameEntity',entityId:'marker',name:' '}],[{kind:'removeEntity',entityId:'missing'}]] as PatchOp[][]){expect(edit(s,ops).ok).toBe(false);expect(s.inspect()).toEqual(before);}
 expect(edit(s,[{kind:'removeEntity',entityId:'marker'}],99)).toMatchObject({ok:false,error:{code:'CONFLICT'}});
 expect(s.inspect()).toEqual(before);
 expect(edit(s,[{kind:'removeEntity',entityId:'camera_close'}]).ok).toBe(true);
});
it('evaluates add/remove cycles without reusing removed transforms',()=>{
 const s=setup();for(let i=0;i<100;i++){
 const entity={...makeSmokeScene().entities.find(e=>e.id==='marker')!,id:'temporary',transform:{position:[i,0,0],rotation:[0,0,0,1],scale:[1,1,1]}} as SceneEntity;
 expect(edit(s,[{kind:'createEntity',entity}]).ok).toBe(true);expect(s.advance(i*2).scene.entities.find(e=>e.id==='temporary')?.transform.position).toEqual([i,0,0]);
 expect(edit(s,[{kind:'removeEntity',entityId:'temporary'}]).ok).toBe(true);expect(s.advance(i*2+1).scene.entities.some(e=>e.id==='temporary')).toBe(false);
 }
});
