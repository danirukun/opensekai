import {it,expect} from 'vitest';
import {stageLabel} from '../src/editor/load-status';
const entry=(stage:'download'|'textures'|'prepare'|'failed',progress:number|null=null,extra={})=>({entityId:'char',assetId:'a',stage,progress,...extra});
it('labels each stage with the specified copy',()=>{
 expect(stageLabel(entry('download',.4))).toBe('Downloading');
 expect(stageLabel(entry('textures',.5,{count:{done:12,total:24}}))).toBe('Textures 12 of 24');
 expect(stageLabel(entry('prepare'))).toBe('Preparing');
 expect(stageLabel(entry('failed',null,{message:'Asset unavailable'}))).toBe('Asset unavailable');
});
