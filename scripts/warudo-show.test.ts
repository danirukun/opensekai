import {it,expect} from 'vitest';
import {ShowDocumentSchema} from '../packages/contracts/src/schema';
import {toShow,type WarudoScene} from './warudo-show';
type V=[number,number,number];
const rotate=([x,y,z,w]:number[],[vx,vy,vz]:V):V=>{const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+y*tz-z*ty,vy+w*ty+z*tx-x*tz,vz+w*tz+x*ty-y*tx];};
const port=(value:unknown)=>({value:JSON.stringify(value)});
const transform=(position:V,rotation:V,scale:V=[1,1,1])=>port({dataInputs:Object.fromEntries((['Position','Rotation','Scale'] as const).map((k,i)=>[k,port(Object.fromEntries('xyz'.split('').map((c,j)=>[c,[position,rotation,scale][i]![j]])))]))});
const asset=(id:string,typeId:string,ports:Record<string,unknown>,place:ReturnType<typeof transform>=transform([0,0,0],[0,0,0]))=>({id,typeId,name:id,active:true,dataInputs:{...Object.fromEntries(Object.entries(ports).map(([k,v])=>[k,port(v)])),Transform:place}});
const CAMERA='6a05ecf3-1501-4cab-b9d7-84131b881a29',LIGHT='8aa033fb-9386-4d04-bec1-2ec67028f326',CHARACTER='726ab674-a550-474e-8b92-66526a5ad55e',PROP='945f0112-8ebe-4c5e-bda2-700925489a57';
const lens={FieldOfView:35,NearClipPlane:0.01,FarClipPlane:5000,ControlSensitivity:1};
const scene:WarudoScene={name:'Bonj Test',plugins:{'Warudo.Core':{data:JSON.stringify({mainCamera:'close'})}},assets:[
 asset('wide',CAMERA,{...lens,ControlMode:{label:'Free Look',value:1}},transform([-2,3,5],[0,0,0])),
 asset('close',CAMERA,{...lens,ControlMode:{label:'Orbit Character',value:2},FocusCharacter:{id:'playback',name:'Playback'}},transform([1.9,18,3.7],[0,180,0])),
 asset('sun',LIGHT,{Color:{r:1,g:0.968627453,b:0.917647064,a:1},Intensity:1,ShadowEnabled:true,ShadowIntensity:1,SoftShadows:true},transform([0,2,0],[45.1976624,178.039719,0])),
 asset('playback',CHARACTER,{Source:'character://data/Characters/Bonnie.warudo'},transform([1.836,17.12,0],[0,0,0])),
 asset('turned',CHARACTER,{Source:'character://data/Characters/Bonnie.warudo'},transform([0,0,0],[0,90,0])),
 asset('mocap',CHARACTER,{Source:'character://data/Characters/Bonnie.warudo'},transform([0,0,0],[0,0,0],[0,0,0])),
 asset('airship',PROP,{Source:'prop://data/Props/Airship.warudo'},transform([-4.5,13,0],[0,90,0],[1.5,1.5,1.5])),
 asset('mirror',PROP,{Source:'prop://workshop/1/Props/mirror.warudo'}),
 asset('screen','941fc894-cab8-4495-9d7a-e0826e832b96',{}),
]};
const bindings={'character://data/Characters/Bonnie.warudo':'avatar_catboy','prop://data/Props/Airship.warudo':'airship_glb'};
const {show,skipped}=toShow(scene,bindings);
const entity=(id:string)=>show.scene.entities.find(e=>e.id===id) as {transform:{position:V;rotation:number[];scale:V}}&Record<string,unknown>;
it('writes a show that the OpenSekai show schema accepts, with outputs on the Warudo main camera',()=>{
 expect(ShowDocumentSchema.safeParse(show).success).toBe(true);
 expect(show.scene.outputs.map(o=>[o.id,o.cameraId])).toEqual([['output_main','close'],['preview_main','close']]);
});
it('mirrors Unity positions on X and keeps the light pointing the same way in the mirrored world',()=>{
 expect(entity('playback').transform.position).toEqual([-1.836,17.12,0]);
 // Unity forward for Euler (x, y, 0) is (sin y cos x, -sin x, cos y cos x); the mirror negates X. OpenSekai lights look along -Z.
 const [x,y]=[45.1976624*Math.PI/180,178.039719*Math.PI/180];
 rotate(entity('sun').transform.rotation,[0,0,-1]).forEach((v,i)=>expect(v).toBeCloseTo([-Math.sin(y)*Math.cos(x),-Math.sin(x),Math.cos(y)*Math.cos(x)][i]!,5));
});
it('turns a Unity +Z camera into an OpenSekai camera that still looks along +Z',()=>{
 rotate(entity('wide').transform.rotation,[0,0,-1]).forEach((v,i)=>expect(v).toBeCloseTo([0,0,1][i]!,5));
 rotate(entity('close').transform.rotation,[0,0,-1]).forEach((v,i)=>expect(v).toBeCloseTo([0,0,-1][i]!,5));
});
it('turns the front of a character with Unity yaw 90 toward -X',()=>{
 rotate(entity('turned').transform.rotation,[0,0,1]).forEach((v,i)=>expect(v).toBeCloseTo([-1,0,0][i]!,5));
});
it('maps lens, navigation, and light settings, and reports each asset it leaves out',()=>{
 expect(entity('close')).toMatchObject({lens:{fovDegrees:35,near:0.01,far:5000},navigation:{mode:'orbitCharacter',targetId:'playback',sensitivity:1}});
 expect(entity('wide')).toMatchObject({navigation:{mode:'freeLook',sensitivity:1}});
 expect(entity('sun')).toMatchObject({light:{type:'directional',color:'#fff7ea',shadow:{enabled:true,soft:true}}});
 expect((entity('sun').light as {intensity:number}).intensity).toBeCloseTo(Math.PI,6);
 expect(entity('playback')).toMatchObject({kind:'avatar',assetId:'avatar_catboy'});
 expect(skipped).toEqual([
  {name:'mocap',type:'Character',reason:'scale 0 hides it in Warudo'},
  {name:'airship',type:'Prop',reason:'prop import is planned (ENV-03, #41)'},
  {name:'mirror',type:'Prop',reason:'prop import is planned (ENV-03, #41)'},
  {name:'screen',type:'Screen',reason:'no OpenSekai mapping for this type'},
 ]);
});
