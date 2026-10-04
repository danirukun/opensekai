import {expect,it} from 'vitest';
import type {AppStatus,AppError} from '@opensekai/contracts';
import {collectWarnings} from '../src/editor/warnings';
it('retains renderer warnings from either output and removes only exact duplicate diagnostics',()=>{
 const warning:AppError={code:'UNSUPPORTED',message:'Spring simulation disabled',ids:['asset_a']};
 const other={...warning,ids:['asset_b']};
 const status={warnings:[warning],outputs:[{lastFrame:{warnings:[warning,other]}},{lastFrame:null},{lastFrame:{warnings:[other]}}]} as unknown as Pick<AppStatus,'warnings'|'outputs'>;
 expect(collectWarnings(status)).toEqual([warning,other]);expect(collectWarnings(null)).toEqual([]);expect(status.warnings).toHaveLength(1);
});
