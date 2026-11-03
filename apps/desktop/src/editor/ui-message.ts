import type { Transform } from '@opensekai/contracts';
export type Tool = 'translate' | 'rotate' | 'scale';
export type Draft = { entityId: string; transform: Transform } | null;
export function fitPreview(width:number,height:number,inset=0){const w=Math.max(0,Math.min(width-inset*2,(height-inset*2)*16/9));return {width:w,height:w*9/16};}
