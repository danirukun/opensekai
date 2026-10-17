import {expect,it} from 'vitest';
import {nextPacketRate} from '../src/editor/tracking-diagnostics';

const status=(packets:number,generation=1,sourceId='a')=>({sourceId,generation,packets});

it('reports packets per second between readings and keeps the last rate inside the interval',()=>{
 const first=nextPacketRate(null,status(10),1000);
 expect(first.perSecond).toBeNull();
 const second=nextPacketRate(first,status(25),1500);
 expect(second.perSecond).toBe(30);
 expect(nextPacketRate(second,status(26),1600)).toBe(second);
});

it.each([['restart',status(3)],['new generation',status(40,2)],['other source',status(40,1,'b')]])('makes the rate unknown after a %s',(_,next)=>{
 const rate=nextPacketRate(nextPacketRate(null,status(10),0),status(20),500);
 expect(nextPacketRate(rate,next,1000).perSecond).toBeNull();
});
