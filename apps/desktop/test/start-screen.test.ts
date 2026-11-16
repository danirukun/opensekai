import {expect,it} from 'vitest';
import {RecentShowSchema,ShowTemplateSchema} from '@opensekai/contracts';
import {startScreenEnds,startScreenOpen} from '../src/editor/start-screen';
const start={name:'Untitled Show',revision:3,blueprintRevision:1};
const open=(input:Partial<Parameters<typeof startScreenOpen>[0]>)=>startScreenOpen({fixtureMode:false,ended:false,start,current:start,...input});
it('opens on an untouched normal launch',()=>{expect(open({})).toBe(true);});
it('stays closed in fixture mode',()=>{expect(open({fixtureMode:true})).toBe(false);});
it('stays closed before the first poll',()=>{expect(open({start:null})).toBe(false);expect(open({current:{...start,revision:null}})).toBe(false);});
it('ends on a scene revision change',()=>{expect(startScreenEnds({start,current:{...start,revision:4}})).toBe(true);});
it('ends on a Blueprint revision change',()=>{expect(startScreenEnds({start,current:{...start,blueprintRevision:2}})).toBe(true);});
it('ends on a rename',()=>{expect(startScreenEnds({start,current:{...start,name:'Live'}})).toBe(true);});
it('does not end while untouched or before the first poll',()=>{expect(startScreenEnds({start,current:start})).toBe(false);expect(startScreenEnds({start:null,current:start})).toBe(false);});
it('stays ended after an undo to the start state',()=>{expect(open({ended:true})).toBe(false);});
it('rejects a recent entry with unknown fields',()=>{
 expect(RecentShowSchema.safeParse({name:'Friday stream',folder:'Shows'}).success).toBe(true);
 expect(RecentShowSchema.safeParse({name:'a',folder:'b',path:'/x'}).success).toBe(false);
 expect(ShowTemplateSchema.safeParse({id:'stage-lights',name:'Stage Lights'}).success).toBe(true);
});
