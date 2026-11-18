import {expect,it} from 'vitest';
import {Object3D,Quaternion,Vector3} from 'three';
import {applyPose,capturePose} from '../src/spring-pose';
// B43 R8: lerp for positions and scales, slerp for rotations; fraction 1 is the current record.
it('captures and blends position, rotation, and scale of each node',()=>{
 const a=new Object3D(),b=new Object3D();const from=capturePose([a,b]);
 a.position.set(2,0,0);a.quaternion.setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);a.scale.setScalar(3);b.position.set(0,4,0);
 const to=capturePose([a,b]);applyPose([a,b],from,to,.5);
 expect(a.position.toArray()).toEqual([1,0,0]);expect(a.scale.toArray()).toEqual([2,2,2]);expect(b.position.toArray()).toEqual([0,2,0]);
 expect(a.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4))).toBeLessThan(1e-7);
 applyPose([a,b],from,to,1);expect(a.position.toArray()).toEqual([2,0,0]);expect(a.scale.toArray()).toEqual([3,3,3]);
 expect(a.quaternion.toArray()).toEqual(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2).toArray());
});
