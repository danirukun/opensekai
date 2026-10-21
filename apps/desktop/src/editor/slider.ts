import type {LightSettings} from '@opensekai/contracts';
// A slider over [min, sliderMax]; a typed value can go up to max, and the slider then stays at its end (B12 R12).
export interface SliderRange {min:number;max:number;step:number;curve:'linear'|'cubic';sliderMax?:number}
const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));
const top=(range:SliderRange)=>Math.min(range.sliderMax??range.max,range.max);
const decimals=(step:number)=>(String(step).split('.')[1]??'').length;
export function roundToStep(value:number,range:SliderRange):number {
 const steps=Math.round((value-range.min)/range.step);
 return clamp(Number((range.min+steps*range.step).toFixed(decimals(range.step))),range.min,range.max);
}
// The slider position from 0 to 1. The cubic curve gives fine control near the minimum of a wide range.
export function toSlider(value:number,range:SliderRange):number {
 const t=clamp((value-range.min)/(top(range)-range.min),0,1);
 return range.curve==='cubic'?Math.cbrt(t):t;
}
export function fromSlider(t:number,range:SliderRange):number {
 const u=clamp(t,0,1);
 return roundToStep(range.min+(range.curve==='cubic'?u**3:u)*(top(range)-range.min),range);
}
// A number field binds a number (or null when empty), not a string.
export function parseInRange(input:string|number|null|undefined,range:SliderRange):number|null {
 const text=String(input??'').trim(),value=Number(text);
 return text!==''&&Number.isFinite(value)&&value>=range.min&&value<=range.max?value:null;
}
// Field ranges (B12 R15). The hard limits are the contract limits.
export const SLIDERS={
 range:{min:0,max:1000,step:0.1,curve:'cubic',sliderMax:50},
 shadowIntensity:{min:0,max:1,step:0.01,curve:'linear'},
 bias:{min:-0.01,max:0.01,step:0.0001,curve:'linear'},
 normalBias:{min:0,max:1,step:0.01,curve:'linear'},
 reflections:{min:0,max:2,step:0.01,curve:'linear'},
 sensitivity:{min:0.1,max:10,step:0.1,curve:'linear'},
 fov:{min:1,max:179,step:1,curve:'linear'},
 cutoff:{min:0.01,max:120,step:0.01,curve:'cubic',sliderMax:20},
 beta:{min:0,max:100,step:0.001,curve:'cubic',sliderMax:10},
 fade:{min:0,max:5,step:0.1,curve:'linear'},
 angle:{min:1,max:170,step:1,curve:'linear'},
 penumbra:{min:0,max:1,step:0.01,curve:'linear'},
 hazeDensity:{min:0,max:2,step:0.01,curve:'linear'},
 smoke:{min:0,max:3,step:0.01,curve:'linear'},
 hazeIntensity:{min:0,max:4,step:0.01,curve:'linear'},
 drift:{min:0,max:2,step:0.01,curve:'linear'},
 fpsCounterSize:{min:8,max:128,step:1,curve:'linear'},
} as const satisfies Record<string,SliderRange>;
export const lightIntensitySlider=(type:LightSettings['type']):SliderRange=>({min:0,max:1000,step:0.01,curve:'cubic',sliderMax:type==='directional'?10:type==='ambient'?2:100});
