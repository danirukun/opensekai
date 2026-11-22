import {DEFAULT_CAMERA_EFFECTS,type CameraEffects,type Id} from '@opensekai/contracts';
// The Inspector fields of the camera effects (B37 R25–R32, #343 R14–R17). Each label is here once.
export const EFFECT_LABELS={
 section:'Effects',lensDirt:'Lens Dirt',none:'None',intensity:'Intensity',threshold:'Threshold',
 vignetting:'Vignetting',color:'Color',alpha:'Alpha',fadeOut:'Fade Out',blink:'Blink',
 nightVision:'Night Vision',blur:'Blur',pixelate:'Pixelate',
 depthOfField:'Depth Of Field',lensFlare:'Lens Flare',anamorphicFlare:'Anamorphic Flare',filmGrain:'Film Grain',
 quality:'Quality',focusSpeed:'Focus Speed',spread:'Spread',vertical:'Vertical',
} as const;
// Per-effect look budget (Warudo-style high-quality flag as a Select). Low → cheap, High → full.
export const EFFECT_QUALITY_OPTIONS=[{value:'low',label:'Low'},{value:'high',label:'High'}] as const;
export type EffectQualityId=(typeof EFFECT_QUALITY_OPTIONS)[number]['value'];
export const effectQualityId=(highQuality:boolean):EffectQualityId=>highQuality?'high':'low';
export const highQualityFromId=(id:string):boolean=>id==='high';
// Each flat field of the Inspector and the group field that it writes. The order is the table order.
export const EFFECT_FIELDS={
 lensDirt:['lensDirt','assetId'],lensDirtIntensity:['lensDirt','intensity'],lensDirtThreshold:['lensDirt','threshold'],
 vignetting:['vignetting','enabled'],vignettingColor:['vignetting','color'],vignettingAlpha:['vignetting','alpha'],vignettingFadeOut:['vignetting','fadeOut'],vignettingBlink:['vignetting','blink'],
 nightVision:['nightVision','enabled'],nightVisionColor:['nightVision','color'],nightVisionAlpha:['nightVision','alpha'],
 blur:['blur','enabled'],blurIntensity:['blur','intensity'],
 pixelate:['pixelate','enabled'],pixelateIntensity:['pixelate','intensity'],
 depthOfField:['depthOfField','enabled'],depthOfFieldHighQuality:['depthOfField','highQuality'],depthOfFieldFocusSpeed:['depthOfField','focusSpeed'],
 lensFlare:['lensFlare','enabled'],lensFlareHighQuality:['lensFlare','highQuality'],lensFlareThreshold:['lensFlare','threshold'],lensFlareIntensity:['lensFlare','intensity'],
 anamorphicFlare:['anamorphicFlare','enabled'],anamorphicFlareHighQuality:['anamorphicFlare','highQuality'],anamorphicFlareIntensity:['anamorphicFlare','intensity'],anamorphicFlareSpread:['anamorphicFlare','spread'],anamorphicFlareVertical:['anamorphicFlare','vertical'],
 filmGrain:['filmGrain','enabled'],filmGrainIntensity:['filmGrain','intensity'],
} as const;
export type EffectFieldId=keyof typeof EFFECT_FIELDS;
export type EffectGroup=keyof Required<CameraEffects>;
export const EFFECT_FIELD_IDS=Object.keys(EFFECT_FIELDS) as EffectFieldId[];
const TOGGLE_GROUPS=['vignetting','nightVision','blur','pixelate','depthOfField','lensFlare','anamorphicFlare','filmGrain'] as const;
type ToggleGroup=(typeof TOGGLE_GROUPS)[number];
const group=(effects:CameraEffects|undefined,name:EffectGroup)=>(effects?.[name]??DEFAULT_CAMERA_EFFECTS[name]) as Record<string,unknown>;
// The value of each field; a missing group shows its defaults (R2).
export const effectValues=(effects?:CameraEffects):Record<EffectFieldId,unknown>=>
 Object.fromEntries(EFFECT_FIELD_IDS.map(id=>{const [name,field]=EFFECT_FIELDS[id];return [id,group(effects,name)[field]];})) as Record<EffectFieldId,unknown>;
// The effects with one field changed. A missing group starts from its defaults, so a first check writes the defaults with `enabled: true` (R28). The model checks the value.
export function withEffect(effects:CameraEffects|undefined,id:EffectFieldId,value:unknown):CameraEffects {
 const [name,field]=EFFECT_FIELDS[id];
 return {...effects,[name]:{...group(effects,name),[field]:value}};
}
// None keeps Intensity and Threshold; a first image writes their defaults (R27, R28).
export const withLensDirt=(effects:CameraEffects|undefined,assetId:Id|null):CameraEffects=>withEffect(effects,'lensDirt',assetId);
// The fields that show: a checkbox and the image select always; a value field only while its effect is on (R26, R30).
export function shownEffectFields(effects?:CameraEffects):EffectFieldId[] {
 const on=(name:ToggleGroup)=>effects?.[name]?.enabled===true;
 return EFFECT_FIELD_IDS.filter(id=>{
  const [name,field]=EFFECT_FIELDS[id];
  if(field==='enabled'||id==='lensDirt')return true;
  return name==='lensDirt'?(effects?.lensDirt?.assetId??null)!==null:on(name as ToggleGroup);
 });
}
