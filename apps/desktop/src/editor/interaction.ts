import type { Transform, Quat, Vec3 } from '@opensekai/contracts';
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export type TransformRow = 'position' | 'rotation' | 'scale';
export function scrubValue(start: number, pixels: number, row: TransformRow): number {
 const value = start + pixels * (row === 'rotation' ? 0.5 : 0.01);
 return row === 'scale' ? Math.max(0.001, value) : value;
}
export function eulerToQuaternion(degrees: Vec3): Quat {
 const [x,y,z] = degrees.map(v => v * Math.PI / 360);
 const [a,b,c] = [Math.cos(x),Math.cos(y),Math.cos(z)];
 const [d,e,f] = [Math.sin(x),Math.sin(y),Math.sin(z)];
 return [d*b*c+a*e*f,a*e*c-d*b*f,a*b*f+d*e*c,a*b*c-d*e*f];
}
export function quaternionToEuler([x,y,z,w]: Quat): Vec3 {
 const length=Math.hypot(x,y,z,w); if (!Number.isFinite(length) || length === 0) return [0,0,0];
 x/=length; y/=length; z/=length; w/=length;
 const m13=2*(x*z+y*w), m23=2*(y*z-x*w), m33=1-2*(x*x+y*y), m12=2*(x*y-z*w), m11=1-2*(y*y+z*z);
 const ry=Math.asin(clamp(m13,-1,1));
 const rx=Math.abs(m13)<0.9999999 ? Math.atan2(-m23,m33) : Math.atan2(2*(y*z+x*w),1-2*(x*x+z*z));
 const rz=Math.abs(m13)<0.9999999 ? Math.atan2(-m12,m11) : 0;
 return [rx,ry,rz].map(v=>v*180/Math.PI) as Vec3;
}
export function menuPosition(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number) {
 return {x:clamp(x,4,Math.max(4,viewportWidth-width-4)),y:clamp(y,4,Math.max(4,viewportHeight-height-4))};
}

export function transformFromRow(base:Transform,row:TransformRow,values:Vec3):Transform|null {
 if(values.some(v=>!Number.isFinite(v))||(row==='scale'&&values.some(v=>v<=0)))return null;
 return {...structuredClone(base),[row]:row==='rotation'?eulerToQuaternion(values):[...values]};
}

export type TransformFieldValues = Record<TransformRow, string[]>;
export function reconcileTransformFields(previousKey:string|null, source:{entityId:string;revision:number;transform:Transform}, values:TransformFieldValues):{key:string;values:TransformFieldValues} {
 const key=JSON.stringify([source.entityId,source.revision,source.transform.position,source.transform.rotation,source.transform.scale]);
 if(key===previousKey)return {key,values};
 return {key,values:{position:source.transform.position.map(String),rotation:quaternionToEuler(source.transform.rotation).map(v=>String(Math.round(v*1000)/1000)),scale:source.transform.scale.map(String)}};
}
