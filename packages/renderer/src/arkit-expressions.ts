import type {Object3D, Mesh} from 'three';

export const arkitNames = [
 'eyeBlinkLeft','eyeLookDownLeft','eyeLookInLeft','eyeLookOutLeft','eyeLookUpLeft','eyeSquintLeft','eyeWideLeft',
 'eyeBlinkRight','eyeLookDownRight','eyeLookInRight','eyeLookOutRight','eyeLookUpRight','eyeSquintRight','eyeWideRight',
 'jawForward','jawLeft','jawRight','jawOpen','mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight',
 'mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight',
 'mouthStretchLeft','mouthStretchRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper',
 'mouthPressLeft','mouthPressRight','mouthLowerDownLeft','mouthLowerDownRight','mouthUpperUpLeft','mouthUpperUpRight',
 'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight','cheekPuff','cheekSquintLeft',
 'cheekSquintRight','noseSneerLeft','noseSneerRight','tongueOut'
] as const;
const canonicalNames = new Map<string,string>();
for (const name of arkitNames) {
 canonicalNames.set(name.toLowerCase(),name);
 canonicalNames.set(name.replace(/Left$/, '_L').replace(/Right$/, '_R').toLowerCase(),name);
}
export function canonicalArkitName(name:string):string|undefined {return canonicalNames.get(name.toLowerCase());}
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
