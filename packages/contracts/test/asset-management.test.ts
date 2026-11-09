import {expect,it} from 'vitest';
import {AssetCatalogSchema,PatchOpSchema} from '../src/schema';
it('validates strict rename and remove operations and trims names',()=>{
 expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name:'  Stage  '})).toMatchObject({success:true,data:{name:'Stage'}});
 for(const name of ['', '  ', 'x'.repeat(129)])expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name}).success).toBe(false);
 expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name:'😀'.repeat(64)}).success).toBe(true);
 expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name:'😀'.repeat(65)}).success).toBe(false);
 expect(PatchOpSchema.safeParse({kind:'removeEntity',entityId:'a'}).success).toBe(true);
 expect(PatchOpSchema.safeParse({kind:'removeEntity',entityId:'a',force:true}).success).toBe(false);
});
it('counts catalog lengths in UTF-16 units and requires lower case tags',()=>{
 const ok=(description:string|null,tags:string[])=>AssetCatalogSchema.safeParse({description,tags}).success;
 expect(ok('😀'.repeat(140),['ステージ','x'.repeat(32)])).toBe(true);
 expect(ok('😀'.repeat(141),[])).toBe(false);
 expect(ok('',[])).toBe(false);
 expect(ok(null,Array(9).fill('a'))).toBe(false);
 expect(ok(null,['Palm'])).toBe(false);
 expect(ok(null,['x'.repeat(33)])).toBe(false);
});
