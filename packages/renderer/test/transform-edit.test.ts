import { it, expect } from 'vitest';
import { persistentTransform } from '../src/transform-edit';
import type { Transform } from '@opensekai/contracts';
const pose = (x: number, scale = 1): Transform => ({position:[x,0,0],rotation:[0,0,0,1],scale:[scale,scale,scale]});
it('removes animation from translation and scale',()=>expect(persistentTransform(pose(2,2),pose(20,4),pose(23,6))).toEqual(pose(5,3)));
it('applies world rotation delta',()=>{const start={...pose(0),rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2] as Transform['rotation']}; expect(persistentTransform(pose(0),start,{...start,rotation:[0,0,1,0]}).rotation[2]).toBeCloseTo(Math.SQRT1_2);});
it('rejects invalid transforms',()=>{for(const bad of [pose(NaN),pose(0,0),{...pose(0),rotation:[0,0,0,0] as Transform['rotation']}]) expect(()=>persistentTransform(pose(0),pose(0),bad)).toThrow();});
