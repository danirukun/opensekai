import {expect,it} from 'vitest';
import {Color} from 'three/webgpu';
import {VRMExpressionMaterialColorBind} from '@pixiv/three-vrm';
import {MToonNodeMaterial} from '@pixiv/three-vrm/nodes';
import {supportNodeMaterialColorBinds} from '../src/mtoon-binds';

it('applies VRM material color binds to MToon node materials',()=>{
 supportNodeMaterialColorBinds();
 const material=new MToonNodeMaterial({transparent:true});material.color.setRGB(1,.5,.25);
 const bind=new VRMExpressionMaterialColorBind({material,type:'color',targetValue:new Color(0,0,0),targetAlpha:0});
 bind.applyWeight(1);
 expect(material.color.toArray()).toEqual([0,0,0]);expect(material.opacity).toBe(0);
 bind.clearAppliedWeight();
 expect(material.color.toArray()).toEqual([1,.5,.25]);expect(material.opacity).toBe(1);
});
