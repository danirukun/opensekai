import {expect,it} from 'vitest';
import {makeSmokeScene,type AssetRecord,type SceneEntity} from '@opensekai/contracts';
import {addLimitReached,makeAuthoringEntity,screenLimitReached} from '../src/editor/authoring';
import {sectionsFor} from '../src/editor/inspector-sections';
import {groupEntities} from '../src/editor/asset-groups';
import {changedFields,defaultsFor,resetFieldIds} from '../src/editor/property-defaults';
import {sceneSourceOptions} from '../src/editor/environment';
import {DEFAULT_WEB_SCREEN,clampWebSize,contentOptions,imageSourceOptions,parseWebUrl,webLimitReached} from '../src/editor/screen';
const sha='a'.repeat(64);
const image=(id:string,name:string,format:AssetRecord['format']='png'):AssetRecord=>({id,format,sha256:sha,bytes:1,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name,expressions:[],image:{width:4,height:3,frames:1}});
const room:AssetRecord={id:'scene_room',format:'glb',sha256:sha,bytes:1,sourceUrl:null,licenseLabel:'',importerVersion:1,name:'Room',expressions:[]};
const avatar:AssetRecord={...room,id:'avatar_a',format:'vrm',name:'Avatar'};
it('creates a screen without an image, names the second one Screen 2, and stops at 16 screens (R17)',()=>{
 const scene=makeSmokeScene().entities;
 const first=makeAuthoringEntity('screen','s1',scene);
 expect(first).toEqual({id:'s1',name:'Screen',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'screen',content:{kind:'image',assetId:null}});
 expect(makeAuthoringEntity('screen','s2',[...scene,first]).name).toBe('Screen 2');
 const many:SceneEntity[]=[...scene];
 while(many.filter(e=>e.kind==='screen').length<15)many.push(makeAuthoringEntity('screen',`s${many.length}`,many));
 expect([addLimitReached('screen',many),screenLimitReached(many)]).toEqual([false,false]);
 many.push(makeAuthoringEntity('screen','last',many));
 expect([addLimitReached('screen',many),screenLimitReached(many)]).toEqual([true,true]);
 // The 64-entity limit applies too.
 const full:SceneEntity[]=[...scene];
 while(full.length<64)full.push(makeAuthoringEntity('prop',`p${full.length}`,full));
 expect(addLimitReached('screen',full)).toBe(true);
});
it('groups screens under Screens after Props, with a Transform and a Screen section (R18, R19)',()=>{
 const scene=[...makeSmokeScene().entities,makeAuthoringEntity('prop','p',[]),makeAuthoringEntity('screen','s',[])];
 const labels=groupEntities(scene).map(group=>group.label);
 expect(labels.indexOf('Screens')).toBe(labels.indexOf('Props')+1);
 expect(groupEntities(scene).find(group=>group.label==='Screens')!.entities.map(e=>e.id)).toEqual(['s']);
 expect(sectionsFor(makeAuthoringEntity('screen','s',[]),{expressions:false}).map(section=>section.label)).toEqual(['Transform','Screen']);
});
it('resets the image to none and marks a chosen image as changed (R19)',()=>{
 const screen=makeAuthoringEntity('screen','s',[]);
 expect(resetFieldIds(screen)).toEqual(['visible','position','rotation','scale','content','image']);
 expect(defaultsFor(screen).image).toBeNull();
 expect(changedFields(screen).has('image')).toBe(false);
 expect(changedFields({...screen,content:{kind:'image',assetId:'image_a'}} as SceneEntity).has('image')).toBe(true);
});
it('lists only image records for a screen, and no image record for a prop or an environment (R19, R20)',()=>{
 const assets=[image('image_logo','Logo'),image('image_anim','Anim','gif'),room,avatar];
 expect(imageSourceOptions(null,assets)).toEqual([{value:'',label:'Choose image…'},{value:'image_logo',label:'Logo'},{value:'image_anim',label:'Anim'},{value:'__import__',label:'Import file…'}]);
 expect(imageSourceOptions('image_gone',assets).map(o=>o.label)).toContain('Missing image');
 expect(imageSourceOptions('scene_room',assets).find(o=>o.value==='scene_room')!.label).toBe('Missing image');
 expect(sceneSourceOptions(null,assets).map(o=>o.value)).toEqual(['','scene_room','__import__']);
});
// B30 R13: the Content select and the Web page fields.
const webScreen=(id:string,content:Partial<typeof DEFAULT_WEB_SCREEN>={}):SceneEntity=>({...makeAuthoringEntity('screen',id,[]),id,content:{kind:'web',...DEFAULT_WEB_SCREEN,...content}} as SceneEntity);
it('disables Web page at the web screen limit, unless the screen already shows a page',()=>{
 const scene:SceneEntity[]=[...makeSmokeScene().entities,webScreen('w0'),webScreen('w1'),webScreen('w2')];
 expect(contentOptions('image',scene).map(o=>[o.label,o.disabled])).toEqual([['Image',false],['Web page',false]]);
 scene.push(webScreen('w3'));
 expect(webLimitReached(scene)).toBe(true);
 expect(contentOptions('image',scene)[1]!.disabled).toBe(true);
 expect(contentOptions('web',scene)[1]!.disabled).toBe(false);
});
it('commits an empty URL as none and keeps text that fails the URL rule',()=>{
 expect(parseWebUrl('')).toEqual({ok:true,url:null});
 expect(parseWebUrl('  https://example.com/chat  ')).toEqual({ok:true,url:'https://example.com/chat'});
 for(const text of ['example.com','http://example.com/','https://localhost/','https://10.0.0.1/'])expect(parseWebUrl(text)).toEqual({ok:false});
});
it('clamps the page size to its range and keeps the value for text that is not a number',()=>{
 expect([clampWebSize('width','10',1280),clampWebSize('width','5000',1280),clampWebSize('height','5000',720),clampWebSize('height','400.6',720)]).toEqual([64,3840,2160,401]);
 expect([clampWebSize('width','',1280),clampWebSize('width','abc',1280),clampWebSize('width',null,1280)]).toEqual([1280,1280,1280]);
 // A bound number input gives a number.
 expect([clampWebSize('width',5000,1280),clampWebSize('height',300,720)]).toEqual([3840,300]);
});
it('resets Content to Image and the web fields to the add values (B17)',()=>{
 const web=webScreen('w',{url:'https://example.com/',width:400,height:900,onTop:true});
 expect(resetFieldIds(web)).toEqual(['visible','position','rotation','scale','content','url','width','height','onTop']);
 expect(defaultsFor(web)).toMatchObject({content:'image',url:null,width:1280,height:720,onTop:false});
 expect([...changedFields(web)]).toEqual(['content','url','width','height','onTop']);
 expect([...changedFields(webScreen('w'))]).toEqual(['content']);
});
