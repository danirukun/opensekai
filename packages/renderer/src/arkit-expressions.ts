import type {Object3D, Mesh} from 'three';

import { ARKIT_NAMES, canonicalArkitName } from '@opensekai/contracts';

export const arkitNames = ARKIT_NAMES;
export { canonicalArkitName };
type Slot = {mesh:Mesh;index:number};
export function createArkitMorphBinding(scene:Object3D) {
 const slots=new Map<string,Slot[]>();
 scene.traverse(node=>{
  const mesh=node as Mesh;
  if(!mesh.isMesh || !mesh.morphTargetInfluences)return;
  for(const [name,index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
   const canonical=canonicalArkitName(name);
   if(!canonical || !Number.isInteger(index) || index<0 || index>=mesh.morphTargetInfluences.length)continue;
   const targets=slots.get(canonical) ?? [];targets.push({mesh,index});slots.set(canonical,targets);
  }
 });
 let previous:Slot[]=[];
 return {
  has:(name:string)=>slots.has(name),
  clear(){for(const {mesh,index} of previous)mesh.morphTargetInfluences![index]=0;previous=[];},
  apply(weights:Record<string,number>){
   for(const [name,weight] of Object.entries(weights))for(const slot of slots.get(name) ?? []){
    slot.mesh.morphTargetInfluences![slot.index]=weight;previous.push(slot);
   }
  }
 };
}
