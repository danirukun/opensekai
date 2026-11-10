import {expect,it} from 'vitest';
import {BODY_PARTS,defaultTrackingConfig,makeSmokeScene,type AvatarBodyTracking,type AvatarTracking,type SceneEntity,type SceneView} from '@opensekai/contracts';
import {bodyPartOptions,bodyTrackingOf,withBodyPart,withBodyTracking,withSource} from '../src/editor/live-fields';
import {changedFields,valuesFor} from '../src/editor/property-defaults';
import {makeEntityCopy} from '../src/editor/asset-management';
import {planCancel} from '../src/editor/tracking-guide-plan';
import {makeAuthoringEntity} from '../src/editor/authoring';

const ids={bodySourceId:'vmc',faceSourceId:'phone',fingersSourceId:'camera'};
const body:AvatarBodyTracking={movementIntensity:1.5,trackedParts:['head','body']};

it('shows the default group for a character without one and lists each part one time (R8)',()=>{
 expect(bodyTrackingOf(undefined)).toEqual({movementIntensity:1,trackedParts:[...BODY_PARTS]});
 expect(bodyTrackingOf({bodySourceId:null,faceSourceId:null,body})).toEqual(body);
 expect(bodyPartOptions.map(option=>option.value)).toEqual([...BODY_PARTS]);
});
it('changes the body group and keeps the source IDs; the default group is left out (R8)',()=>{
 expect(withBodyTracking(ids,{movementIntensity:0.5})).toEqual({...ids,body:{movementIntensity:0.5,trackedParts:[...BODY_PARTS]}});
 expect(withBodyTracking({...ids,body},{movementIntensity:2})).toEqual({...ids,body:{movementIntensity:2,trackedParts:['head','body']}});
 expect(withBodyTracking({...ids,body:{movementIntensity:0.5,trackedParts:[...BODY_PARTS]}},{movementIntensity:1})).toEqual(ids);
 expect(withBodyTracking(undefined,{movementIntensity:1})).toEqual({bodySourceId:null,faceSourceId:null});
 expect(withBodyPart(ids,'leftLeg',false)).toEqual({...ids,body:{movementIntensity:1,trackedParts:BODY_PARTS.filter(part=>part!=='leftLeg')}});
 expect(withBodyPart({...ids,body},'rightArm',true)).toEqual({...ids,body:{movementIntensity:1.5,trackedParts:['head','body','rightArm']}});
 expect(withBodyPart({...ids,body:{movementIntensity:1,trackedParts:BODY_PARTS.filter(part=>part!=='leftLeg')}},'leftLeg',true)).toEqual(ids);
 expect(withBodyPart({...ids,body},'head',false)).toEqual({...ids,body:{movementIntensity:1.5,trackedParts:['body']}});
});
it('keeps the body group when a source select changes (R8)',()=>{
 expect(withSource({...ids,body},'body','vmc-b')).toEqual({...ids,bodySourceId:'vmc-b',body});
 expect(withSource({...ids,body},'fingers','')).toEqual({bodySourceId:'vmc',faceSourceId:'phone',body});
});
it('works on a state proxy, which structuredClone rejects (R8)',()=>{
 // The Inspector gives the tracking of a Svelte state proxy. A Proxy has the same limit in Node.
 const proxied=<T extends object>(value:T):T=>new Proxy(value,{get:(target,key,receiver)=>{const item=Reflect.get(target,key,receiver);return typeof item==='object'&&item!==null?proxied(item):item;}});
 const tracking=proxied<AvatarTracking>({...ids,body:{movementIntensity:1.5,trackedParts:['head','body']}});
 expect(()=>structuredClone(tracking)).toThrow();
 expect(withBodyPart(tracking,'leftLeg',true)).toEqual({...ids,body:{movementIntensity:1.5,trackedParts:['head','body','leftLeg']}});
 expect(withBodyTracking(tracking,{movementIntensity:0.5})).toEqual({...ids,body:{movementIntensity:0.5,trackedParts:['head','body']}});
 expect(withSource(tracking,'fingers','')).toEqual({bodySourceId:'vmc',faceSourceId:'phone',body:{movementIntensity:1.5,trackedParts:['head','body']}});
 expect(withBodyPart(proxied<AvatarTracking>({bodySourceId:null,faceSourceId:null}),'head',false)).toEqual({bodySourceId:null,faceSourceId:null,body:{movementIntensity:1,trackedParts:BODY_PARTS.filter(part=>part!=='head')}});
 for(const result of [withBodyPart(tracking,'leftLeg',true),withSource(tracking,'body','x')])expect(()=>structuredClone(result)).not.toThrow();
});
it('marks only the changed field for a reset (R8)',()=>{
 const avatar=makeAuthoringEntity('character','a',[]);if(avatar.kind!=='avatar')throw new Error('kind');
 expect(valuesFor(avatar)).toMatchObject({bodyMovementIntensity:1,trackedParts:[...BODY_PARTS]});
 const changed=(tracking:AvatarTracking)=>[...changedFields({...avatar,tracking})].filter(id=>id==='bodyMovementIntensity'||id==='trackedParts');
 expect(changed({bodySourceId:null,faceSourceId:null})).toEqual([]);
 expect(changed({bodySourceId:null,faceSourceId:null,body:{movementIntensity:0.5,trackedParts:[...BODY_PARTS]}})).toEqual(['bodyMovementIntensity']);
 expect(changed({bodySourceId:null,faceSourceId:null,body:{movementIntensity:1,trackedParts:['head']}})).toEqual(['trackedParts']);
 // An opened show can hold the parts in another order; the same parts are not a change.
 expect(changed({bodySourceId:null,faceSourceId:null,body:{movementIntensity:1,trackedParts:[...BODY_PARTS].reverse()}})).toEqual([]);
});
it('keeps the body group on a duplicate and on a guide cancel (R9)',()=>{
 const scene=makeSmokeScene() as SceneView;
 const config=defaultTrackingConfig('vmc');
 const source={id:'vmc',kind:'tracking',name:'vmc',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},config,generation:1} as SceneEntity;
 scene.entities.push(source);
 const performer=scene.entities.find(entity=>entity.id==='performer')!;if(performer.kind!=='avatar')throw new Error('kind');
 performer.tracking={bodySourceId:'vmc',faceSourceId:null,body};
 const copy=makeEntityCopy(performer,'copy',scene.entities);
 expect(copy.kind==='avatar'&&copy.tracking).toEqual({bodySourceId:null,faceSourceId:null,body});
 const operations=planCancel(scene,{avatarId:'performer',tracking:{bodySourceId:null,faceSourceId:null,body},sourceId:'vmc',created:false,mapping:undefined},false);
 expect(operations.find(operation=>operation.kind==='setAvatarTracking')).toMatchObject({tracking:{bodySourceId:null,faceSourceId:null,body}});
});
