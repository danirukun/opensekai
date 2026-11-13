import {it,expect} from 'vitest';
import {defaultTrackingConfig,makeSmokeScene,type TrackingSample,type TrackingStatus,type SceneEntity} from '@opensekai/contracts';
import {createTrackingComposer} from '../src/tracking';
const sample=(id:string,time:number,value:number,space:'raw'|'normalized'='raw',generation=1):TrackingSample=>({sourceId:id,generation,receivedAtMs:time,bones:{head:{space,rotation:[0,Math.sin(value/2),0,Math.cos(value/2)],position:[value,0,0]}},expressions:{jawOpen:value},root:{position:[value,0,0],rotation:[0,Math.sin(value/2),0,Math.cos(value/2)]}});
function fixture(kind:'facekit'){
 const scene=makeSmokeScene(),config=defaultTrackingConfig(kind);config.enabled=true;
 scene.entities.push({id:'source',kind:'tracking',name:'Tracker',visible:true,generation:1,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},config} as SceneEntity);
 const avatar=scene.entities.find(e=>e.kind==='avatar')!;if(avatar.kind==='avatar')avatar.tracking={bodySourceId:null,faceSourceId:'source'};
 const composer=createTrackingComposer();return {scene,composer,ingest:(s:TrackingSample)=>composer.ingest({samples:[s],statuses:[]},scene),pose:(t:number)=>composer.evaluate(scene,t).avatarPoses[0]};
}
const status=(state:TrackingStatus['state'],error:string|null=null):TrackingStatus=>({sourceId:'source',generation:1,state,packets:1,invalidPackets:0,lastReceivedAtMs:null,error});
const state=(f:ReturnType<typeof fixture>,t:number)=>f.composer.evaluate(f.scene,t).trackingStatus[0].state;
it.each(['unavailable','permissionNeeded'] as const)('keeps %s and drops the sample as for error',failed=>{
 const f=fixture('facekit'),twin=fixture('facekit');
 for(const [g,s] of [[f,failed],[twin,'error']] as const){
  g.composer.ingest({samples:[sample('source',100,.8,'normalized')],statuses:[status('receiving')]},g.scene);
  expect(state(g,150)).toBe('receiving');
  g.composer.ingest({samples:[],statuses:[status(s,'reason')]},g.scene);
 }
 expect(state(f,160)).toBe(failed);
 expect(f.pose(160)).toEqual(twin.pose(160));
 f.composer.ingest({samples:[],statuses:[status('waiting')]},f.scene);
 expect(state(f,170)).toBe('waiting');
});
