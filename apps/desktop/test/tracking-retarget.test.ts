import {describe,it,expect} from 'vitest';
import {createRetargeter} from '../src/tracking/retarget';
import {TrackingSampleSchema} from '@opensekai/contracts';
const config={kind:'mediapipe' as const,enabled:true,deviceId:'',face:true,upperBody:true,hands:true,mirror:false};
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const face=(matrix=identity)=>({matrix,blendshapes:[{categoryName:'eyeBlinkLeft',score:.8},{categoryName:'jawOpen',score:.6}]});
const p=(x:number,y:number,z=0)=>({x,y,z,visibility:1});
function pose(){const a=Array.from({length:33},()=>p(0,0));a[11]=p(1,-1);a[12]=p(-1,-1);a[23]=p(.5,1);a[24]=p(-.5,1);a[13]=p(2,-1);a[15]=p(3,-1);a[14]=p(-2,-1);a[16]=p(-3,-1);return a;}
function hand(){const a=Array.from({length:21},()=>p(0,0));a[0]=p(0,0);for(const [start,y] of [[1,-.6],[5,-.3],[9,0],[13,.3],[17,.6]])for(let j=0;j<4;j++)a[start+j]=p(j+1,y);return a;}
describe('MediaPipe normalized retargeting',()=>{
 it('calibrates neutral then follows matrix yaw and clamps named ARKit weights',()=>{const r=createRetargeter();const s=r.map({face:face()},config,'a',3,100);expect(s.bones.head.rotation).toEqual([0,0,0,1]);expect(s.expressions.eyeBlinkLeft).toBe(.8);expect(s.expressions.jawOpen).toBe(.6);const t=Math.PI/3,c=Math.cos(t),n=Math.sin(t);const yaw=[c,0,-n,0,0,1,0,0,n,0,c,0,0,0,0,1];const q=r.map({face:face(yaw)},config,'a',3,101).bones.head.rotation;expect(Math.abs(q[1])).toBeCloseTo(.5);expect(q[3]).toBeCloseTo(Math.sqrt(3)/2);expect(TrackingSampleSchema.safeParse(s).success).toBe(true);});
 it('keeps asymmetric arms local to their parent and omits root/legs',()=>{const a=pose();a[13]=p(1,0);a[15]=p(2,0);const s=createRetargeter().map({pose:a},config,'a',1,0);expect(s.bones.leftUpperArm.rotation).not.toEqual(s.bones.rightUpperArm.rotation);expect(s.bones.leftLowerArm.rotation).not.toEqual([0,0,0,1]);expect(s.root).toBeUndefined();expect(s.bones.leftUpperLeg).toBeUndefined();expect(TrackingSampleSchema.safeParse(s).success).toBe(true);});
 it('maps palm and finger bend with handedness',()=>{const a=hand();a[7]=p(2,-.3,-1);a[8]=p(2,-.3,-2);const s=createRetargeter().map({hands:[{landmarks:a,handedness:'Left'}]},config,'a',1,0);expect(s.bones.leftHand).toBeDefined();expect(s.bones.leftIndexIntermediate.rotation).not.toEqual([0,0,0,1]);expect(s.bones.rightHand).toBeUndefined();expect(TrackingSampleSchema.safeParse(s).success).toBe(true);});
 it('mirrors side channels and reflections without non-unit rotations',()=>{const r=createRetargeter();const s=r.map({face:face(),hands:[{landmarks:hand(),handedness:'Left'}]}, {...config,mirror:true},'a',1,0);expect(s.expressions.eyeBlinkRight).toBe(.8);expect(s.expressions.eyeBlinkLeft).toBeUndefined();expect(s.bones.rightHand).toBeDefined();expect(TrackingSampleSchema.safeParse(s).success).toBe(true);});
 it('drops degenerate and nonfinite observations',()=>{const s=createRetargeter().map({pose:Array.from({length:33},()=>p(0,0)),face:face(Array(16).fill(NaN)),hands:[{landmarks:Array.from({length:21},()=>p(0,0)),handedness:'Left'}]},config,'a',1,0);expect(s.bones).toEqual({});expect(TrackingSampleSchema.safeParse(s).success).toBe(true);});
});
