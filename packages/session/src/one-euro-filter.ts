import type {Quat,Vec3} from '@opensekai/contracts';

export interface OneEuroOptions {minCutoff:number;beta:number;derivativeCutoff:number;resetAfterMs:number}
export interface SignalFilter<T> {filter(value:T,timeMs:number):T;reset():void}
export const DEFAULT_ONE_EURO_OPTIONS:Readonly<OneEuroOptions>=Object.freeze({minCutoff:1,beta:.1,derivativeCutoff:1,resetAfterMs:500});
function options(overrides:Partial<OneEuroOptions>):OneEuroOptions {
 const o={...DEFAULT_ONE_EURO_OPTIONS,...overrides};
 if(!Object.values(o).every(Number.isFinite)||o.minCutoff<=0||o.beta<0||o.derivativeCutoff<=0||o.resetAfterMs<=0)throw new RangeError('Invalid One Euro options');
 return o;
}
function time(timeMs:number){if(!Number.isFinite(timeMs)||timeMs<0)throw new RangeError('Invalid filter time');}
function finite(value:number){if(!Number.isFinite(value))throw new RangeError('Invalid filter value');}
const alpha=(cutoff:number,dt:number)=>1/(1+1/(2*Math.PI*cutoff*dt));
const mix=(a:number,b:number,weight:number)=>(1-weight)*a+weight*b;

export function createOneEuroFilter(overrides:Partial<OneEuroOptions>={}):SignalFilter<number>{
 const o=options(overrides);let lastTime:number|null=null,raw=0,filtered=0,derivative=0;
 return {
 filter(value,timeMs){finite(value);time(timeMs);
  if(lastTime!==null&&timeMs<=lastTime)return filtered;
  if(lastTime===null||timeMs-lastTime>o.resetAfterMs){lastTime=timeMs;raw=filtered=value;derivative=0;return value;}
  const dt=(timeMs-lastTime)/1000;
  derivative=mix(derivative,(value-raw)/dt,alpha(o.derivativeCutoff,dt));
  filtered=mix(filtered,value,alpha(o.minCutoff+o.beta*Math.abs(derivative),dt));
  raw=value;lastTime=timeMs;return filtered;
 },reset(){lastTime=null;raw=filtered=derivative=0;}
 };
}
export function createOneEuroVec3Filter(overrides:Partial<OneEuroOptions>={}):SignalFilter<Vec3>{
 const axes=[createOneEuroFilter(overrides),createOneEuroFilter(overrides),createOneEuroFilter(overrides)];
 return {filter(value,timeMs){if(value.length!==3)throw new RangeError('Invalid vector');value.forEach(finite);time(timeMs);return axes.map((axis,i)=>axis.filter(value[i],timeMs)) as Vec3;},reset(){axes.forEach(axis=>axis.reset());}};
}
function normalize(value:Quat):Quat {
 if(value.length!==4)throw new RangeError('Invalid quaternion');value.forEach(finite);const length=Math.hypot(...value);
 if(length===0||!Number.isFinite(length))throw new RangeError('Invalid quaternion');
 if(Math.abs(length-1)<1e-12)return [...value];return value.map(v=>v/length) as Quat;
}
const dot=(a:Quat,b:Quat)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
function slerp(a:Quat,b:Quat,weight:number):Quat {
 const d=dot(a,b),target=b.map(v=>d<0?-v:v) as Quat,cosine=Math.min(1,Math.abs(d));
 if(cosine>.9995)return normalize(a.map((v,i)=>mix(v,target[i],weight)) as Quat);
 const angle=Math.acos(cosine),sin=Math.sin(angle),left=Math.sin((1-weight)*angle)/sin,right=Math.sin(weight*angle)/sin;
 return normalize(a.map((v,i)=>left*v+right*target[i]) as Quat);
}
export function createOneEuroQuaternionFilter(overrides:Partial<OneEuroOptions>={}):SignalFilter<Quat>{
 const o=options(overrides);let lastTime:number|null=null,raw:Quat=[0,0,0,1],filtered:Quat=[0,0,0,1],speed=0;
 return {filter(value,timeMs){const q=normalize(value);time(timeMs);
  if(lastTime!==null&&timeMs<=lastTime)return [...filtered];
  if(lastTime===null||timeMs-lastTime>o.resetAfterMs){lastTime=timeMs;raw=filtered=q;speed=0;return [...filtered];}
  const dt=(timeMs-lastTime)/1000,angularSpeed=2*Math.acos(Math.min(1,Math.abs(dot(raw,q))))/dt;
  speed=mix(speed,angularSpeed,alpha(o.derivativeCutoff,dt));
  filtered=slerp(filtered,q,alpha(o.minCutoff+o.beta*speed,dt));raw=q;lastTime=timeMs;return [...filtered];
 },reset(){lastTime=null;raw=filtered=[0,0,0,1];speed=0;}};
}
