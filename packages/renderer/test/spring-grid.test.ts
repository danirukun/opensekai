import {expect,it} from 'vitest';
import {planSpringSteps} from '../src/spring-grid';
const clock=(tick:number,elapsedMs:number,resets=0,sessionId='s')=>({sessionId,tick,elapsedMs,resets});
// B43 R6: the reset rules of the time grid.
it('resets on the first frame, a new session, a step back in time, and a gap over 15 steps',()=>{
 expect(planSpringSteps(null,clock(3,50))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(3,50),clock(4,70,0,'t'))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(30,500),clock(2,40))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(0,0),clock(16,267))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(0,0),clock(15,250)).fractions).toHaveLength(15);
});
// B43 R8: one step for each grid point, interpolated in frame time.
it('runs one step for each grid point after the previous tick, with fractions in frame time',()=>{
 const plan=planSpringSteps(clock(1,20),clock(3,52));
 expect(plan.reset).toBe(false);expect(plan.fractions).toHaveLength(2);
 expect(plan.fractions[0]).toBeCloseTo((1000/30-20)/32,12);expect(plan.fractions[1]).toBeCloseTo(30/32,12);
});
// B43 R6, R7: no due step runs nothing; a reset count change resets, then steps on the current record.
it('runs no step for the same tick, and full-weight steps after a reset count change',()=>{
 expect(planSpringSteps(clock(3,50),clock(3,52))).toEqual({reset:false,fractions:[]});
 expect(planSpringSteps(clock(3,50),clock(3,52,1))).toEqual({reset:true,fractions:[]});
 expect(planSpringSteps(clock(3,50),clock(5,84,1))).toEqual({reset:true,fractions:[1,1]});
});
