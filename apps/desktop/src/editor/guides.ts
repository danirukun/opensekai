export interface GuideSettings {center:boolean;thirds:boolean}
export interface GuideLine {x1:number;y1:number;x2:number;y2:number}
export type Guide=keyof GuideSettings;
export const GUIDE_STORAGE_KEY='opensekai.scene.guides';
export const NO_GUIDES:GuideSettings=Object.freeze({center:false,thirds:false});
const ARM=12;

export function readGuides(raw:string|null):GuideSettings{
 try{const value=JSON.parse(raw??'null') as unknown;if(value&&typeof value==='object')return {center:(value as Record<string,unknown>).center===true,thirds:(value as Record<string,unknown>).thirds===true};}catch{/* An invalid value means no guides. */}
 return NO_GUIDES;
}
export const writeGuides=(settings:GuideSettings)=>JSON.stringify({center:settings.center,thirds:settings.thirds});
export const guidesOn=(settings:GuideSettings)=>settings.center||settings.thirds;
export const toggleGuide=(settings:GuideSettings,guide:Guide):GuideSettings=>({...settings,[guide]:!settings[guide]});

// The center of the device pixel that holds a CSS coordinate, kept inside the frame, so a 1 device pixel line is sharp.
function snap(value:number,size:number,dpr:number){const pixels=Math.max(1,Math.floor(size*dpr));return (Math.min(pixels-1,Math.max(0,Math.floor(value*dpr)))+0.5)/dpr;}

export function guideLines(width:number,height:number,dpr:number,settings:GuideSettings):GuideLine[]{
 if(!(width>0&&height>0&&dpr>0))return [];
 const x=(value:number)=>snap(value,width,dpr),y=(value:number)=>snap(value,height,dpr),lines:GuideLine[]=[];
 if(settings.thirds)for(const part of [1/3,2/3]){lines.push({x1:x(width*part),y1:0,x2:x(width*part),y2:height},{x1:0,y1:y(height*part),x2:width,y2:y(height*part)});}
 if(settings.center){const cx=x(width/2),cy=y(height/2),arm=Math.min(ARM,width/2,height/2);lines.push({x1:cx-arm,y1:cy,x2:cx+arm,y2:cy},{x1:cx,y1:cy-arm,x2:cx,y2:cy+arm});}
 return lines;
}
