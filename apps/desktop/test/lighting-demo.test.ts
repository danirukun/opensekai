import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ShowDocumentSchema,isLitLight,lightBudgetError,rotateByQuaternion,type SceneEntity} from '@opensekai/contracts';

type Light=Extract<SceneEntity,{kind:'light'}>;
const show=ShowDocumentSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/shows/lighting-demo.osekai',import.meta.url)),'utf8')));
const lights=show.scene.entities.filter(e=>e.kind==='light') as Light[];
const CHEST:[number,number,number]=[0,1.4,0];

describe('lighting demo fixture show (character lighting Task 7)',()=>{
 it('has the avatar without a lighting group, one haze, and the two cameras',()=>{
  const avatar=show.scene.entities.find(e=>e.kind==='avatar');
  expect(avatar&&'lighting' in avatar).toBe(false);
  expect(show.scene.entities.filter(e=>e.kind==='haze')).toHaveLength(1);
  expect(show.scene.entities.filter(e=>e.kind==='camera').map(e=>e.name)).toEqual(['Wide','Face']);
 });
 it('has 4 lit lights, 2 beam spot lights, 1 shadow light, and no light budget error',()=>{
  expect(lights).toHaveLength(6);
  expect(lights.filter(e=>isLitLight(e.light)).map(e=>e.id)).toEqual(['light_key','light_back_left','light_back_right','light_ambient']);
  expect(lights.filter(e=>e.light.beam?.enabled===true).map(e=>e.id)).toEqual(['beam_left','beam_right']);
  expect(lights.filter(e=>e.light.shadow.enabled).map(e=>e.id)).toEqual(['light_key']);
  expect(lightBudgetError(show.scene.entities)).toBeNull();
 });
 it('aims the key and the two back lights at the avatar chest, within 0.05 m',()=>{
  for(const id of ['light_key','light_back_left','light_back_right']){
   const e=lights.find(l=>l.id===id)!;
   const [px,py,pz]=e.transform.position;
   const [dx,dy,dz]=rotateByQuaternion([0,0,-1],e.transform.rotation);
   const t=(CHEST[0]-px)*dx+(CHEST[1]-py)*dy+(CHEST[2]-pz)*dz;
   expect(t,id).toBeGreaterThan(0);
   expect(Math.hypot(px+t*dx-CHEST[0],py+t*dy-CHEST[1],pz+t*dz-CHEST[2]),id).toBeLessThan(0.05);
  }
 });
});
