import {expect,it} from 'vitest';
import {guideLines,guidesOn,NO_GUIDES,readGuides,toggleGuide,writeGuides} from '../src/editor/guides';

const both={center:true,thirds:true};

it('reads saved guides and treats a missing or invalid value as no guides (R7)',()=>{
 expect(readGuides(null)).toEqual(NO_GUIDES);
 expect(readGuides('not json')).toEqual(NO_GUIDES);
 expect(readGuides('"center"')).toEqual(NO_GUIDES);
 expect(readGuides('{"center":"yes","thirds":1}')).toEqual(NO_GUIDES);
 expect(readGuides('{"center":true}')).toEqual({center:true,thirds:false});
 expect(readGuides(writeGuides(both))).toEqual(both);
 expect(JSON.parse(writeGuides({...both,extra:1} as never))).toEqual(both);
});
it('toggles each guide on its own and reports the on state (R1, R2)',()=>{
 const center=toggleGuide(NO_GUIDES,'center');
 expect(center).toEqual({center:true,thirds:false});
 expect(toggleGuide(center,'thirds')).toEqual(both);
 expect(toggleGuide(center,'center')).toEqual(NO_GUIDES);
 expect(NO_GUIDES).toEqual({center:false,thirds:false});
 expect([guidesOn(NO_GUIDES),guidesOn(center),guidesOn({center:false,thirds:true})]).toEqual([false,true,true]);
});
it('draws nothing when the guides are off or the frame is empty',()=>{
 expect(guideLines(640,360,1,NO_GUIDES)).toEqual([]);
 expect(guideLines(0,360,1,both)).toEqual([]);
 expect(guideLines(640,360,0,both)).toEqual([]);
});
it.each([[1920,1080,'16:9'],[540,960,'9:16'],[800,600,'4:3']])('puts thirds at 1/3 and 2/3 of a %ix%i (%s) frame, edge to edge (R3, R4)',(width,height)=>{
 const lines=guideLines(width,height,1,{center:false,thirds:true});
 const vertical=lines.filter(l=>l.x1===l.x2),horizontal=lines.filter(l=>l.y1===l.y2);
 expect(vertical.map(l=>l.x1)).toEqual([Math.floor(width/3)+0.5,Math.floor(width*2/3)+0.5]);
 expect(horizontal.map(l=>l.y1)).toEqual([Math.floor(height/3)+0.5,Math.floor(height*2/3)+0.5]);
 for(const l of vertical)expect([l.y1,l.y2]).toEqual([0,height]);
 for(const l of horizontal)expect([l.x1,l.x2]).toEqual([0,width]);
});
it('centers the mark on the frame with 12 px arms (R3)',()=>{
 expect(guideLines(800,600,1,{center:true,thirds:false})).toEqual([{x1:388.5,y1:300.5,x2:412.5,y2:300.5},{x1:400.5,y1:288.5,x2:400.5,y2:312.5}]);
 const small=guideLines(10,16,1,{center:true,thirds:false});
 expect(small[0]).toEqual({x1:0.5,y1:8.5,x2:10.5,y2:8.5});
 expect(small[1]?.y2!-small[1]?.y1!).toBe(10);
});
it.each([2,1.5,1.25])('puts each line on a device pixel center at device pixel ratio %s (R4)',dpr=>{
 const width=1001.3,height=563.2;
 for(const l of guideLines(width,height,dpr,both)){
  for(const v of l.x1===l.x2?[l.x1]:[l.y1]){expect((v*dpr)%1).toBeCloseTo(0.5,6);}
  if(l.x1===l.x2)expect(l.x1).toBeLessThan(width);else expect(l.y1).toBeLessThan(height);
 }
 const vertical=guideLines(width,height,dpr,{center:false,thirds:true}).filter(l=>l.x1===l.x2);
 expect(Math.abs(vertical[0]!.x1-width/3)).toBeLessThanOrEqual(1/dpr);
});
