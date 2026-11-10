import {DEFAULT_CAMERA_GRADING,type CameraGrading} from '@opensekai/contracts';
// The Inspector fields of a camera grading: one flat field for each value of the group (CAM-06 R15).
export const GRADING_FIELD_IDS=['toneMapping','exposure','brightness','contrast','vibrance','tint','bloomIntensity','bloomThreshold','bloomRadius'] as const;
export type GradingFieldId=(typeof GRADING_FIELD_IDS)[number];
export interface GradingValues {toneMapping:CameraGrading['toneMapping'];exposure:number;brightness:number;contrast:number;vibrance:number;tint:string;bloomIntensity:number;bloomThreshold:number;bloomRadius:number}
export const gradingValues=(grading:CameraGrading=DEFAULT_CAMERA_GRADING):GradingValues=>({toneMapping:grading.toneMapping,exposure:grading.exposure,brightness:grading.brightness,contrast:grading.contrast,vibrance:grading.vibrance,tint:grading.tint,bloomIntensity:grading.bloom.intensity,bloomThreshold:grading.bloom.threshold,bloomRadius:grading.bloom.radius});
const BLOOM={bloomIntensity:'intensity',bloomThreshold:'threshold',bloomRadius:'radius'} as const;
// The full group with one field changed. The model checks the value.
export function withGradingValue(grading:CameraGrading,id:GradingFieldId,value:unknown):CameraGrading {
 if(id==='bloomIntensity'||id==='bloomThreshold'||id==='bloomRadius')return {...grading,bloom:{...grading.bloom,[BLOOM[id]]:value as number}};
 return {...grading,bloom:{...grading.bloom},[id]:value};
}
