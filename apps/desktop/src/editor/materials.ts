import {MATERIAL_PARAMETERS,savedMaterialValue,type AssetMaterial,type AssetRecord,type MaterialParameter,type MaterialValues,type SceneEntity} from '@opensekai/contracts';
import type {SliderRange} from './slider';

// B38 R29: the Inspector Materials section of a character or a prop.
type Saved=Readonly<Record<string,MaterialValues>>|undefined;
export interface MaterialChoice {value:string;label:string;missing:boolean}
export interface MaterialRow {parameter:MaterialParameter;label:string;value:string|number;range?:SliderRange;saved:boolean;readOnly:boolean}

const SLIDER:Partial<Record<MaterialParameter,SliderRange>>={
 opacity:{min:0,max:1,step:0.01,curve:'linear'},
 emissionStrength:{min:0,max:100,step:0.01,curve:'cubic',sliderMax:10},
 outlineWidth:{min:0,max:0.05,step:0.0001,curve:'linear'},
};

/** The model record materials of a character or of a prop with an asset model. */
export function recordMaterials(entity:SceneEntity,assets:readonly AssetRecord[]):AssetMaterial[]|undefined {
 const assetId=entity.kind==='avatar'?entity.assetId:entity.kind==='mesh'&&entity.source.kind==='asset'?entity.source.assetId:null;
 return assetId===null?undefined:assets.find(asset=>asset.id===assetId)?.materials;
}
export const savedMaterials=(entity:SceneEntity):Saved=>entity.kind==='avatar'||entity.kind==='mesh'?entity.materials:undefined;
export const showsMaterials=(record:readonly AssetMaterial[]|undefined,saved:Saved):boolean=>(record?.length??0)>0||Object.keys(saved??{}).length>0;

/** The record materials in file order, then the saved names that the record does not have. */
export function materialChoices(record:readonly AssetMaterial[]|undefined,saved:Saved):MaterialChoice[] {
 const names=new Set((record??[]).map(material=>material.name));
 return [
  ...(record??[]).map(material=>({value:material.name,label:material.name,missing:false})),
  ...Object.keys(saved??{}).filter(name=>!names.has(name)).map(name=>({value:name,label:`${name} (Missing)`,missing:true})),
 ];
}

/**
 * The parameters that apply, in R14 order, with the saved value or else the model value. A saved parameter that does not
 * apply (a missing material, or a model change) is a read-only row, so its reset mark can remove it.
 */
export function materialRows(record:readonly AssetMaterial[]|undefined,saved:Saved,name:string):MaterialRow[] {
 const material=record?.find(item=>item.name===name);
 return MATERIAL_PARAMETERS.flatMap(spec=>{
  const value=savedMaterialValue(saved,name,spec.key);
  const applies=material!==undefined&&spec.applies(material);
  if(!applies&&value===undefined)return [];
  return [{parameter:spec.key,label:spec.label,value:value??material?.model[spec.key]??spec.defaultValue,...(spec.type==='number'?{range:SLIDER[spec.key]!}:{}),saved:value!==undefined,readOnly:!applies}];
 });
}
