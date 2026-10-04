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

interface ScalarState {timeMs:number;raw:number;filtered:number;derivative:number}
function seconds(timeMs:number,lastTime:number):number {
 const dt=(timeMs-lastTime)/1000;if(!Number.isFinite(dt)||dt<=0)throw new RangeError('Unusable filter interval');return dt;
}
function scalarStep(state:ScalarState|null,value:number,timeMs:number,o:OneEuroOptions):ScalarState {
 finite(value);time(timeMs);
 if(state&&timeMs<=state.timeMs)return state;
 if(!state||timeMs-state.timeMs>o.resetAfterMs)return {timeMs,raw:value,filtered:value,derivative:0};
 const dt=seconds(timeMs,state.timeMs),rawDerivative=(value-state.raw)/dt;
 finite(rawDerivative);
 const derivative=mix(state.derivative,rawDerivative,alpha(o.derivativeCutoff,dt)),cutoff=o.minCutoff+o.beta*Math.abs(derivative);
 finite(derivative);finite(cutoff);
 const filtered=mix(state.filtered,value,alpha(cutoff,dt));finite(filtered);
 return {timeMs,raw:value,filtered,derivative};
}
export function createOneEuroFilter(overrides:Partial<OneEuroOptions>={}):SignalFilter<number>{
 const o=options(overrides);let state:ScalarState|null=null;
 return {filter(value,timeMs){state=scalarStep(state,value,timeMs,o);return state.filtered;},reset(){state=null;}};
}
export function createOneEuroVec3Filter(overrides:Partial<OneEuroOptions>={}):SignalFilter<Vec3>{
 const o=options(overrides);let states:(ScalarState|null)[]=[null,null,null];
 return {filter(value,timeMs){if(value.length!==3)throw new RangeError('Invalid vector');
  const next=value.map((v,i)=>scalarStep(states[i],v,timeMs,o));states=next;return next.map(state=>state.filtered) as Vec3;
 },reset(){states=[null,null,null];}};
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
  const dt=seconds(timeMs,lastTime),angularSpeed=2*Math.acos(Math.min(1,Math.abs(dot(raw,q))))/dt;
  finite(angularSpeed);const nextSpeed=mix(speed,angularSpeed,alpha(o.derivativeCutoff,dt)),cutoff=o.minCutoff+o.beta*nextSpeed;
  finite(nextSpeed);finite(cutoff);const nextFiltered=slerp(filtered,q,alpha(cutoff,dt));
  speed=nextSpeed;filtered=nextFiltered;raw=q;lastTime=timeMs;return [...filtered];
 },reset(){lastTime=null;raw=filtered=[0,0,0,1];speed=0;}};
}
