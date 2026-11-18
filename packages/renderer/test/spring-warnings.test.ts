import {expect,it} from 'vitest';
import {extensionWarnings} from '../src/assets';
// B43 R14: spring bones run; node constraints and spring bone limits do not.
it('warns for node constraints and spring bone limits only',()=>{
 expect(extensionWarnings(['VRMC_vrm','VRMC_springBone','VRMC_node_constraint','VRMC_springBone_limit'],'avatar_a')).toEqual([
  {code:'UNSUPPORTED',message:'VRMC_node_constraint simulation is disabled in renderer',ids:['avatar_a']},
  {code:'UNSUPPORTED',message:'VRMC_springBone_limit is not supported; spring bones move without limits',ids:['avatar_a']}]);
 expect(extensionWarnings(['VRM','VRMC_springBone'],'avatar_b')).toEqual([]);
});
