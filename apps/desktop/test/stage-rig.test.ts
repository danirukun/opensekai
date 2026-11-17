import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ShowDocumentSchema,isLitLight,rotateByQuaternion,type SceneEntity,type Vec3} from '@opensekai/contracts';

type Light=Extract<SceneEntity,{kind:'light'}>;
const read=(name:string)=>JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/shows/${name}`,import.meta.url)),'utf8'));
const show=ShowDocumentSchema.parse(read('stage-rig.osekai'));
const beams=ShowDocumentSchema.parse(read('stage-beams.osekai'));
const lights=show.scene.entities.filter(e=>e.kind==='light') as Light[];
const heads=lights.filter(e=>e.id.startsWith('head_'));
const twelve=Array.from({length:12},(_,k)=>k+1);
const x=(i:number)=>-4.4+0.8*(i-1);
// The table of the plan: row, position, aim point, and the colors for odd and even i.
const ROWS={
 back:{position:(i:number):Vec3=>[x(i),4.4,-4.5],aim:(i:number):Vec3=>[1.5*x(i),0,3],colors:['#40e0d0','#c070ff']},
 front:{position:(i:number):Vec3=>[x(i),4.8,2.5],aim:(i:number):Vec3=>[0.5*x(i),0,-2],colors:['#ffd2a0','#ff60b0']},
} as const;
const BEAM_AIMS:Record<string,Vec3>={beam_front_1:[-1.5,0,-1],beam_front_2:[-0.5,1.2,0],beam_front_3:[0.5,1.2,0],beam_front_4:[1.5,0,-1],beam_back_2:[-1,0,2.5],beam_back_3:[1,0,2.5]};
const aims:Record<string,Vec3>={...BEAM_AIMS,...Object.fromEntries((['back','front'] as const).flatMap(row=>twelve.map(i=>[`head_${row}_${String(i).padStart(2,'0')}`,ROWS[row].aim(i)])))};

describe('stage rig fixture show (light limits R19)',()=>{
 it('has 32 lights, 8 lit, 24 unlit spot lights, 30 beams, and 2 shadow lights',()=>{
  expect(show.name).toBe('Stage Rig');
  expect(lights).toHaveLength(32);
  expect(lights.filter(e=>isLitLight(e.light)).map(e=>e.id)).toEqual(['light_main','stage_ambient','beam_front_1','beam_front_2','beam_front_3','beam_front_4','beam_back_2','beam_back_3']);
  const unlit=lights.filter(e=>!isLitLight(e.light));
  expect(unlit).toHaveLength(24);
  expect(unlit.every(e=>e.light.type==='spot')).toBe(true);
  expect(lights.filter(e=>e.light.beam?.enabled===true)).toHaveLength(30);
  expect(lights.filter(e=>e.light.shadow.enabled).map(e=>e.id)).toEqual(['beam_front_2','beam_front_3']);
  expect(show.scene.entities.some(e=>e.kind==='haze'||e.kind==='avatar')).toBe(false);
  // The lit lights keep the Stage Beams values with the three affect flags on.
  for(const e of lights.filter(e=>isLitLight(e.light))){
   const source=beams.scene.entities.find(b=>b.id===e.id) as Light;
   expect(e).toEqual({...source,light:{...source.light,affectCharacters:true,affectProps:true,affectEnvironment:true}});
  }
  expect(show.scene.outputs).toEqual(beams.scene.outputs);
  expect(show.scene.entities.filter(e=>e.kind==='camera'||e.kind==='environment')).toEqual(beams.scene.entities.filter(e=>e.kind==='camera'||e.kind==='environment'));
 });
 it('gives each head the position and the color of the plan table',()=>{
  expect(heads).toHaveLength(24);
  for(const row of ['back','front'] as const)for(const i of twelve){
   const head=heads.find(e=>e.id===`head_${row}_${String(i).padStart(2,'0')}`)!;
   expect(head.name).toBe(`Head ${row==='back'?'Back':'Front'} ${i}`);
   ROWS[row].position(i).forEach((v,k)=>expect(head.transform.position[k]).toBeCloseTo(v,6));
   expect(head.light).toEqual({color:ROWS[row].colors[(i+1)%2],range:12,affectCharacters:false,affectProps:false,affectEnvironment:false,shadow:{enabled:false,intensity:1,soft:true,bias:-0.0005,normalBias:0.02},type:'spot',intensity:60,cone:{angleDegrees:10,penumbra:0.4},beam:{enabled:true,intensity:1,softness:0.5}});
   expect(head.visible).toBe(true);
   expect(head.transform.scale).toEqual([1,1,1]);
  }
 });
 it('aims each spot light at its aim point, within 0.05 m',()=>{
  const spots=lights.filter(e=>e.light.type==='spot');
  expect(spots.map(e=>e.id).sort()).toEqual(Object.keys(aims).sort());
  for(const e of spots){
   const [px,py,pz]=e.transform.position;
   const [ax,ay,az]=aims[e.id]!;
   const [dx,dy,dz]=rotateByQuaternion([0,0,-1],e.transform.rotation);
   const t=(ax-px)*dx+(ay-py)*dy+(az-pz)*dz;
   const miss=Math.hypot(px+t*dx-ax,py+t*dy-ay,pz+t*dz-az);
   expect(t,e.id).toBeGreaterThan(0);
   expect(miss,e.id).toBeLessThan(0.05);
  }
 });
});
