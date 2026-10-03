import type {Quat, Vec3, TrackingSample, TrackingConfig, TrackingBone} from '@opensekai/contracts';
export interface Landmark {x:number;y:number;z:number;visibility?:number;presence?:number}
export interface Observation {
  face?:{matrix?:number[];blendshapes?:{categoryName:string;score:number}[]};
  pose?:Landmark[];
  hands?:{landmarks:Landmark[];handedness:string}[];
}
type Config=Extract<TrackingConfig,{kind:'mediapipe'}>;
const I:Quat=[0,0,0,1];
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unit(a:Vec3):Vec3|null {const n=Math.hypot(...a);return Number.isFinite(n)&&n>1e-6?a.map(v=>v/n) as Vec3:null;}
function normalize(q:Quat):Quat {const n=Math.hypot(...q);return n>1e-6&&Number.isFinite(n)?q.map(v=>v/n) as Quat:[...I];}
const inverse=(q:Quat):Quat=>[-q[0],-q[1],-q[2],q[3]];
function mul(a:Quat,b:Quat):Quat{return normalize([a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]);}
function rotate(q:Quat,v:Vec3):Vec3 {const t=cross([q[0],q[1],q[2]],v).map(n=>n*2) as Vec3;const c=cross([q[0],q[1],q[2]],t);return v.map((n,i)=>n+q[3]*t[i]+c[i]) as Vec3;}
function fromTo(a:Vec3,b:Vec3):Quat|null {const u=unit(a),v=unit(b);if(!u||!v)return null;const d=dot(u,v);if(d<-.999999){const axis=unit(cross(u,Math.abs(u[0])<.9?[1,0,0]:[0,1,0]))!;return [...axis,0];}const c=cross(u,v);return normalize([...c,1+d]);}
function fromBasis(x:Vec3,y:Vec3,z:Vec3):Quat {
 const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2],t=m00+m11+m22;
 if(t>0){const s=Math.sqrt(t+1)*2;return normalize([(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4]);}
 if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;return normalize([s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s]);}
 if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;return normalize([(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s]);}
 const s=Math.sqrt(1+m22-m00-m11)*2;return normalize([(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s]);
}
function point(p:Landmark|undefined):Vec3|null{return p&&[p.x,p.y,p.z].every(Number.isFinite)&&(p.visibility??1)>=.5&&(p.presence??1)>=.5?[p.x,-p.y,-p.z]:null;}
function faceRotation(m:number[]|undefined):Quat|null {if(!m||m.length!==16||!m.every(Number.isFinite))return null;const x=unit([m[0],m[1],m[2]]);if(!x)return null;const z=unit(cross(x,[m[4],m[5],m[6]]));if(!z)return null;const y=cross(z,x),q=fromBasis(x,y,z);return [q[0],-q[1],-q[2],q[3]];}
const sideName=(name:string)=>name.startsWith('left')?'right'+name.slice(4):name.startsWith('right')?'left'+name.slice(5):name.endsWith('Left')?name.slice(0,-4)+'Right':name.endsWith('Right')?name.slice(0,-5)+'Left':name;
export function createRetargeter(){
 let neutral:Quat|null=null;
 return {
  calibrate(){neutral=null;},
  map(observation:Observation,config:Config,sourceId:string,generation:number,receivedAtMs:number):TrackingSample {
   const bones:Record<string,TrackingBone>={},expressions:Record<string,number>={},global:Record<string,Quat>={};
   const set=(name:string,q:Quat|null)=>{if(q)bones[name]={rotation:normalize(q),space:'normalized'};};
   if(config.face&&observation.face){const q=faceRotation(observation.face.matrix);if(q){neutral??=q;set('head',mul(inverse(neutral),q));}
    for(const b of observation.face.blendshapes??[])if(b.categoryName!=='_neutral'&&/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(b.categoryName)&&Number.isFinite(b.score)&&Object.keys(expressions).length<64)expressions[b.categoryName]=Math.max(0,Math.min(1,b.score));
   }
   if(config.upperBody&&observation.pose){const p=observation.pose.map(point),ls=p[11],rs=p[12],lh=p[23],rh=p[24];
    if(ls&&rs&&lh&&rh){const x=unit(sub(ls,rs)),up=unit(sub(ls.map((v,i)=>(v+rs[i])/2) as Vec3,lh.map((v,i)=>(v+rh[i])/2) as Vec3));
     const z=x&&up?unit(cross(x,up)):null;const chest=x&&z?fromBasis(x,cross(z,x),z):null;
     if(chest){set('chest',chest);
      for(const [side,s,e,w,sign] of [['left',11,13,15,1],['right',12,14,16,-1]] as const){const shoulder=p[s],elbow=p[e],wrist=p[w];if(!shoulder||!elbow||!wrist)continue;
       // Solve each child in its parent's frame, so forearms do not repeat upper-arm rotation.
       const rest:Vec3=[sign,0,0],upper=fromTo(rest,rotate(inverse(chest),sub(elbow,shoulder)));if(!upper)continue;
       set(side+'Shoulder',[...I]);set(side+'UpperArm',upper);const upperWorld=mul(chest,upper);const lower=fromTo(rest,rotate(inverse(upperWorld),sub(wrist,elbow)));set(side+'LowerArm',lower);if(lower)global[side+'LowerArm']=mul(upperWorld,lower);
      }
     }
    }
   }
   if(config.hands)for(const hand of observation.hands??[]){if(hand.handedness!=='Left'&&hand.handedness!=='Right')continue;const side=hand.handedness==='Left'?'left':'right',sign=side==='left'?1:-1,p=hand.landmarks.map(point),w=p[0],middle=p[9],index=p[5],little=p[17];if(!w||!middle||!index||!little)continue;
    const x=unit(sub(middle,w).map(v=>v*sign) as Vec3),across=unit(sub(index,little)),z=x&&across?unit(cross(x,across)):null;if(!x||!z)continue;const palm=fromBasis(x,cross(z,x),z);set(side+'Hand',mul(inverse(global[side+'LowerArm']??I),palm));
    for(const [start,names] of [[1,['ThumbMetacarpal','ThumbProximal','ThumbDistal']],[5,['IndexProximal','IndexIntermediate','IndexDistal']],[9,['MiddleProximal','MiddleIntermediate','MiddleDistal']],[13,['RingProximal','RingIntermediate','RingDistal']],[17,['LittleProximal','LittleIntermediate','LittleDistal']]] as const){let parent=palm;for(let j=0;j<3;j++){const a=p[start+j],b=p[start+j+1];if(!a||!b)break;const q=fromTo([sign,0,0],rotate(inverse(parent),sub(b,a)));if(!q)break;set(side+names[j],q);parent=mul(parent,q);}}
   }
   if(config.mirror){const mirrored:Record<string,TrackingBone>={};for(const [name,b] of Object.entries(bones))mirrored[sideName(name)]={space:'normalized',rotation:[b.rotation[0],-b.rotation[1],-b.rotation[2],b.rotation[3]]};const e:Record<string,number>={};for(const [name,v] of Object.entries(expressions))e[sideName(name)]=v;return {sourceId,generation,receivedAtMs,bones:mirrored,expressions:e};}
   return {sourceId,generation,receivedAtMs,bones,expressions};
  }
 };
}
