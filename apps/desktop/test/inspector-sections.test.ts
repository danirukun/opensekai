import {expect,it} from 'vitest';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {currentSection,isCollapsed,parseSectionState,sectionsFor,setCollapsed,START_STATE,toggleSection} from '../src/editor/inspector-sections';

const ids=(kind:Parameters<typeof makeAuthoringEntity>[0],expressions=false)=>sectionsFor(makeAuthoringEntity(kind,'id',[]),{expressions}).map(section=>section.label);

it('lists the sections of each kind in field order (R11)',()=>{
 expect(ids('camera')).toEqual(['Transform','Rendering','Lens','Control','Screenshot']);
 expect(ids('pointLight')).toEqual(['Transform','Light','Affect','Shadow']);
 expect(ids('ambientLight')).toEqual(['Transform','Light','Affect']);
 expect(ids('haze')).toEqual(['Transform','Haze']);
 expect(ids('environment')).toEqual(['Transform','Environment']);
 expect(ids('character')).toEqual(['Transform','Model','Tracking']);
 expect(ids('character',true)).toEqual(['Transform','Model','Expressions','Tracking']);
 expect(ids('mediapipe')).toEqual(['Receiver','Smoothing','Face','Diagnostics']);
});
it('starts with the former Advanced sections collapsed and the rest expanded (R12)',()=>{
 expect(parseSectionState(null)).toEqual(START_STATE);
 for(const id of ['smoothing','face','diagnostics'])expect(isCollapsed(START_STATE,'tracking',id)).toBe(true);
 expect(isCollapsed(START_STATE,'tracking','receiver')).toBe(false);
 expect(isCollapsed(START_STATE,'light','shadow')).toBe(false);
 // The avatar Tracking section is another section than the tracking source kind.
 expect(isCollapsed(START_STATE,'avatar','tracking')).toBe(false);
});
it('gives the start state for an invalid or oversize stored value (R12)',()=>{
 for(const text of ['','not json','null','[]','{"version":2,"collapsed":[]}','{"version":1,"collapsed":"light:shadow"}','{"version":1,"collapsed":[1]}'])expect(parseSectionState(text)).toEqual(START_STATE);
 const big=JSON.stringify({version:1,collapsed:Array.from({length:400},(_,i)=>`light:section${i}`)});
 expect(big.length).toBeGreaterThan(4096);
 expect(parseSectionState(big)).toEqual(START_STATE);
 expect(parseSectionState('{"version":1,"collapsed":["light:shadow","light:shadow"]}')).toEqual({version:1,collapsed:['light:shadow']});
});
it('toggles a section and keeps the state through a save and a read (R12)',()=>{
 const affect=toggleSection(START_STATE,'light','affect');
 expect(isCollapsed(affect,'light','affect')).toBe(true);
 expect(isCollapsed(affect,'camera','affect')).toBe(false);
 const read=parseSectionState(JSON.stringify(affect));
 expect(read).toEqual(affect);
 const opened=toggleSection(read,'tracking','face');
 expect(isCollapsed(opened,'tracking','face')).toBe(false);
 expect(toggleSection(toggleSection(START_STATE,'light','affect'),'light','affect')).toEqual(START_STATE);
 expect(setCollapsed(START_STATE,'tracking','face',true)).toBe(START_STATE);
 expect(START_STATE.collapsed).toHaveLength(3);
});
it('marks the last section whose top is at or above the scroll top plus 8 px (R14)',()=>{
 const tops=[0,300,700,1200];
 expect(currentSection(tops,0,400,2000)).toBe(0);
 expect(currentSection(tops,250,400,2000)).toBe(0);
 expect(currentSection(tops,292,400,2000)).toBe(1);
 expect(currentSection(tops,291,400,2000)).toBe(0);
 expect(currentSection(tops,800,400,2000)).toBe(2);
 expect(currentSection([20,300],0,400,2000)).toBe(0);
 // At the end of the scroll the last section is current, though its top is below the line.
 expect(currentSection(tops,1600,400,2000)).toBe(3);
 expect(currentSection(tops,1599.5,400,2000)).toBe(3);
 // A column that does not scroll marks the first section.
 expect(currentSection([0,100],0,400,400)).toBe(0);
 expect(currentSection([],0,400,2000)).toBe(-1);
});
