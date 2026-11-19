import {DEFAULT_AVATAR_LIGHTING,type AvatarLighting} from '@opensekai/contracts';
// The Inspector fields of the character lighting: one field for each value of the group.
export const LIGHTING_FIELD_IDS=['rimStrength','rimWidth','rimTint','shadowStrength','environmentFill'] as const;
export type LightingFieldId=(typeof LIGHTING_FIELD_IDS)[number];
export const lightingValues=(lighting:AvatarLighting=DEFAULT_AVATAR_LIGHTING):AvatarLighting=>({rimStrength:lighting.rimStrength,rimWidth:lighting.rimWidth,rimTint:lighting.rimTint,shadowStrength:lighting.shadowStrength,environmentFill:lighting.environmentFill});
// The full group with one field changed. The model checks the value.
export const withLightingValue=(lighting:AvatarLighting,id:LightingFieldId,value:unknown):AvatarLighting=>({...lighting,[id]:value});
