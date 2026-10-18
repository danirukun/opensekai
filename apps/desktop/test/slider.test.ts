import {expect,it} from 'vitest';
import {fromSlider,lightIntensitySlider,parseInRange,roundToStep,SLIDERS,toSlider,type SliderRange} from '../src/editor/slider';

const linear:SliderRange={min:0,max:2,step:0.01,curve:'linear'};
it('maps a linear range both ways and rounds to the step',()=>{
 expect(toSlider(1,linear)).toBe(0.5);
 expect(fromSlider(0.5,linear)).toBe(1);
 expect(fromSlider(0.12345,linear)).toBe(0.25);
 expect(roundToStep(0.304,SLIDERS.bias)).toBe(0.01);
 expect(roundToStep(-0.00012,SLIDERS.bias)).toBe(-0.0001);
});
it('gives the cubic curve fine travel near the minimum and keeps the ends',()=>{
 const range=lightIntensitySlider('point');
 expect(fromSlider(0,range)).toBe(0);
 expect(fromSlider(1,range)).toBe(100);
 expect(fromSlider(0.5,range)).toBe(12.5);
 expect(toSlider(12.5,range)).toBeCloseTo(0.5,6);
 expect(fromSlider(toSlider(20,range),range)).toBe(20);
});
it('pins a typed value above the slider end and keeps the hard limit for typing',()=>{
 const range=lightIntensitySlider('directional');
 expect(toSlider(500,range)).toBe(1);
 expect(parseInRange('500',range)).toBe(500);
 expect(parseInRange('1001',range)).toBeNull();
 expect(parseInRange('',range)).toBeNull();
 expect(parseInRange('abc',range)).toBeNull();
});
it('accepts the number that a number field binds, and rejects its empty value',()=>{
 const range=lightIntensitySlider('point');
 expect(parseInRange(500,range)).toBe(500);
 expect(parseInRange(0,range)).toBe(0);
 expect(parseInRange(null,range)).toBeNull();
 expect(parseInRange(undefined,range)).toBeNull();
 expect(parseInRange(1001,range)).toBeNull();
});
it('starts a range above zero at its minimum',()=>{
 expect(fromSlider(0,SLIDERS.cutoff)).toBe(0.01);
 expect(toSlider(0.01,SLIDERS.cutoff)).toBe(0);
 expect(fromSlider(1,SLIDERS.cutoff)).toBe(20);
 expect(fromSlider(-1,SLIDERS.sensitivity)).toBe(0.1);
});
