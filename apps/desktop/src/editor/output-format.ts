import {OUTPUT_FRAME_LIMITS,OUTPUT_RENDER_SCALES,OUTPUT_SIZES,type OutputFrameLimit,type OutputRenderScale,type OutputSpec} from '@opensekai/contracts';
export interface OutputFormat {width:number;height:number;fps:OutputFrameLimit;renderScale:OutputRenderScale}
export const sizeValue=(size:{width:number;height:number})=>`${size.width}x${size.height}`;
export const outputSizeOptions=OUTPUT_SIZES.map(size=>({value:sizeValue(size),label:`${size.width} × ${size.height}`}));
export const renderScaleOptions=[...OUTPUT_RENDER_SCALES].reverse().map(scale=>({value:String(scale),label:`${scale*100}%`}));
export const frameLimitOptions=[...OUTPUT_FRAME_LIMITS].reverse().map(fps=>({value:String(fps),label:`${fps} FPS`}));
// A missing output reads as the default format; a missing render scale means 1 (B22 R1).
export function outputFormat(output:OutputSpec|undefined):OutputFormat {
 return {width:output?.width??1920,height:output?.height??1080,fps:output?.fps??60,renderScale:output?.renderScale??1};
}
// Each select changes one field; the other fields keep the scene values (B22 R11).
export function changedFormat(current:OutputFormat,field:'size'|'renderScale'|'fps',value:string):OutputFormat|null {
 if(field==='size'){const size=OUTPUT_SIZES.find(item=>sizeValue(item)===value);return size?{...current,width:size.width,height:size.height}:null;}
 const number=Number(value);
 if(field==='fps')return OUTPUT_FRAME_LIMITS.find(fps=>fps===number)?{...current,fps:number as OutputFrameLimit}:null;
 return OUTPUT_RENDER_SCALES.find(scale=>scale===number)?{...current,renderScale:number as OutputRenderScale}:null;
}
export function formatField(format:OutputFormat,field:'size'|'renderScale'|'fps'):string {
 return field==='size'?sizeValue(format):String(format[field]);
}
