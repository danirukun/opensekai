import {expect,it} from 'vitest';
import {PatchOpSchema} from '../src/schema';
it('validates strict rename and remove operations and trims names',()=>{
 expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name:'  Stage  '})).toMatchObject({success:true,data:{name:'Stage'}});
 for(const name of ['', '  ', 'x'.repeat(129)])expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name}).success).toBe(false);
 expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name:'😀'.repeat(64)}).success).toBe(true);
 expect(PatchOpSchema.safeParse({kind:'renameEntity',entityId:'a',name:'😀'.repeat(65)}).success).toBe(false);
 expect(PatchOpSchema.safeParse({kind:'removeEntity',entityId:'a'}).success).toBe(true);
 expect(PatchOpSchema.safeParse({kind:'removeEntity',entityId:'a',force:true}).success).toBe(false);
});
