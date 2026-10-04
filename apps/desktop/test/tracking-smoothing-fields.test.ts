import {expect,it} from 'vitest';
import {parseTrackingSmoothing} from '../src/editor/live-fields';
it('parses bounded smoothing numbers and preserves bypass',()=>{
 expect(parseTrackingSmoothing(false,{minCutoff:'.01',beta:'100',derivativeCutoff:'120'})).toEqual({enabled:false,minCutoff:.01,beta:100,derivativeCutoff:120});
 for(const value of ['', ' ', 'NaN', 'Infinity', '0', '120.01'])expect(parseTrackingSmoothing(true,{minCutoff:value,beta:'.5',derivativeCutoff:'1'})).toBeNull();
 expect(parseTrackingSmoothing(true,{minCutoff:'5',beta:'-1',derivativeCutoff:'1'})).toBeNull();
 expect(parseTrackingSmoothing(true,{minCutoff:'5',beta:'.5',derivativeCutoff:'0'})).toBeNull();
});
it('accepts Svelte number input values and rejects its empty undefined value',()=>{
 expect(parseTrackingSmoothing(true,{minCutoff:5,beta:.5,derivativeCutoff:1})).toEqual({enabled:true,minCutoff:5,beta:.5,derivativeCutoff:1});
 expect(parseTrackingSmoothing(true,{minCutoff:undefined,beta:.5,derivativeCutoff:1})).toBeNull();
});
