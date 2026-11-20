import type {AssetDebug,AssetRecord,MaterialInfo,TextureSlot} from '@opensekai/contracts';
// Character Debug section (R4, R10, R12): the join of the file texture slots and the live textures, and the copied JSON.
export type TextureRow=TextureSlot&{width:number|null;height:number|null;colorSpace:string|null};
export const COUNT_LABELS:Readonly<Record<string,string>>={nodes:'Nodes',meshes:'Meshes',primitives:'Primitives',materials:'Materials',textures:'Textures',images:'Images',skins:'Skins',joints:'Joints',humanoidBones:'Humanoid bones',expressions:'Expressions',springs:'Spring bones',colliders:'Spring colliders',constraints:'Constraints',animations:'Animations'};
export const formatBytes=(bytes:number):string=>bytes<1024?`${bytes} B`:bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(1)} MB`;
export function textureRows(material:MaterialInfo,debug:AssetDebug):TextureRow[] {
 return material.textures.map(slot=>{
  const live=debug.textures.find(texture=>texture.material===material.index&&texture.slot===slot.slot);
  return {...slot,width:live?.width??null,height:live?.height??null,colorSpace:live?.colorSpace??null};
 });
}
export function debugCopy(debug:AssetDebug,record:Pick<AssetRecord,'bytes'|'sha256'>|null) {
 const {info}=debug;
 return {
  file:{...info.format,bytes:record?.bytes??null,sha256:record?.sha256??null},
  extensions:info.extensions,
  meta:info.meta,
  counts:Object.fromEntries(info.counts.map(count=>[count.key,count.value])),
  materials:info.materials.map(material=>({...material,textures:textureRows(material,debug)})),
  warnings:debug.warnings.map(warning=>({code:warning.code,message:warning.message})),
 };
}
