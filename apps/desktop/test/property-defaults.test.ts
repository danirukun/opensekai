import {expect,it} from 'vitest';
import {DEFAULT_TRACKING_SMOOTHING,type SceneEntity} from '@opensekai/contracts';
import {makeAuthoringEntity} from '../src/editor/authoring';
import type {AddKind} from '../src/editor/live-fields';
import {changedFields,defaultsFor,resetFieldIds,sameValue,valuesFor} from '../src/editor/property-defaults';

const KINDS:AddKind[]=['camera','character','environment','directionalLight','pointLight','spotLight','ambientLight','haze','vmc','ifacialmocap','mediapipe'];
const add=(kind:AddKind)=>makeAuthoringEntity(kind,`id_${kind}`,[]);
const atOrigin=(entity:SceneEntity):SceneEntity=>entity.kind==='tracking'?entity:{...entity,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:entity.kind==='haze'?[20,8,20]:[1,1,1]}};

it('gives each new entity, at the reset transform, no changed field (R1)',()=>{
 for(const kind of KINDS)expect([kind,[...changedFields(atOrigin(add(kind)))]]).toEqual([kind,[]]);
});
it('resets a placed entity to the zero transform, and a haze to its add scale (R1, R8)',()=>{
 expect([...changedFields(add('spotLight'))]).toEqual(['position','rotation']);
 expect([...changedFields(add('haze'))]).toEqual(['position']);
 expect(defaultsFor(add('haze')).scale).toEqual([20,8,20]);
});
it('takes a light default from its current type (R1)',()=>{
 const light=add('pointLight');
 if(light.kind!=='light')throw new Error('light');
 expect(defaultsFor(light).intensity).toBe(20);
 const spot={...light,light:{...light.light,type:'spot' as const,intensity:20}};
 expect(defaultsFor(spot)).toMatchObject({intensity:60,range:15,angleDegrees:40,penumbra:.3,volumetric:true});
 expect(changedFields(atOrigin(spot))).toContain('intensity');
});
it('lists the reset fields of each kind and light type, and none of R4 (R3, R4)',()=>{
 const ids=(kind:AddKind)=>resetFieldIds(add(kind));
 const base=['visible','position','rotation','scale'];
 expect(ids('camera')).toEqual([...base,'renderEnvironment','antiAliasing','fovDegrees','near','far','controlMode','sensitivity']);
 expect(ids('directionalLight')).toEqual([...base,'color','intensity','affectCharacters','affectProps','affectEnvironment','shadow']);
 expect(ids('pointLight')).toEqual([...base,'color','intensity','range','volumetric','affectCharacters','affectProps','affectEnvironment','shadow']);
 expect(ids('spotLight')).toEqual([...base,'color','intensity','range','angleDegrees','penumbra','volumetric','affectCharacters','affectProps','affectEnvironment','shadow']);
 expect(ids('ambientLight')).toEqual([...base,'color','intensity','affectCharacters','affectProps','affectEnvironment']);
 expect(ids('haze')).toEqual([...base,'density','smoke','intensity','drift']);
 expect(ids('environment')).toEqual([...base,'reflectionsIntensity']);
 expect(ids('character')).toEqual([...base,'idleAnimation']);
 const tracking=['smoothing','minCutoff','beta','derivativeCutoff','headIntensity','headOffsetX','headOffsetY','headOffsetZ','eyeIntensity','blendShapeSensitivity','linkedBlink'];
 expect(ids('vmc')).toEqual(['bindAddress','port','address',...tracking]);
 expect(ids('ifacialmocap')).toEqual(['bindAddress','port','address',...tracking]);
 expect(ids('mediapipe')).toEqual(['face','upperBody','hands','mirror',...tracking]);
 const all=new Set(KINDS.flatMap(kind=>ids(kind)));
 for(const excluded of ['name','type','assetId','bodySourceId','faceSourceId','fingersSourceId','targetId','deviceId','calibration'])expect(all.has(excluded)).toBe(false);
});
it('shows the shadow details only with the shadow on, and Control Sensitivity only with a control mode',()=>{
 const light=add('directionalLight');
 if(light.kind!=='light')throw new Error('light');
 const shadowed={...light,light:{...light.light,shadow:{...light.light.shadow,enabled:true}}};
 expect(resetFieldIds(shadowed).slice(-5)).toEqual(['shadow','shadowIntensity','soft','bias','normalBias']);
 expect([...changedFields(atOrigin(shadowed))]).toEqual(['shadow']);
 const camera=add('camera');
 if(camera.kind!=='camera')throw new Error('camera');
 const still={...camera,navigation:{mode:'none' as const}};
 expect(resetFieldIds(still)).not.toContain('sensitivity');
 expect([...changedFields(atOrigin(still))]).toEqual(['controlMode']);
});
it('compares numbers within floating point noise, colors without case, and vectors by component (R2)',()=>{
 expect(sameValue(3,3+1e-12)).toBe(true);
 expect(sameValue(2.999,3)).toBe(false);
 expect(sameValue(1e6,1e6+1e-4)).toBe(true);
 expect(sameValue(-0.0005,-0.0005000000000001)).toBe(true);
 expect(sameValue('#FFFFFF','#ffffff')).toBe(true);
 expect(sameValue('#fffffe','#ffffff')).toBe(false);
 expect(sameValue([0,0,1e-12],[0,0,0])).toBe(true);
 expect(sameValue([0,0,0.1],[0,0,0])).toBe(false);
 expect(sameValue(null,null)).toBe(true);
 expect(sameValue('127.0.0.1','0.0.0.0')).toBe(false);
});
it('treats a missing optional field as its fallback (R2)',()=>{
 const camera=add('camera'),environment=add('environment'),source=add('vmc');
 if(camera.kind!=='camera'||environment.kind!=='environment'||source.kind!=='tracking')throw new Error('kinds');
 expect(valuesFor({...camera,renderEnvironment:undefined,antiAliasing:undefined})).toMatchObject({renderEnvironment:true,antiAliasing:'none'});
 expect(changedFields(atOrigin({...environment,reflectionsIntensity:undefined})).size).toBe(0);
 expect(changedFields({...source,smoothing:undefined,mapping:undefined}).size).toBe(0);
 expect(changedFields({...source,smoothing:{...DEFAULT_TRACKING_SMOOTHING,beta:2}})).toEqual(new Set(['beta']));
 const avatar=add('character');
 if(avatar.kind!=='avatar')throw new Error('avatar');
 // A missing idle animation shows off; the add default is on.
 expect(changedFields(atOrigin({...avatar,idleAnimation:undefined}))).toEqual(new Set(['idleAnimation']));
});
it('compares a sender address that is empty with the stored null (R3)',()=>{
 const source=add('ifacialmocap');
 if(source.kind!=='tracking'||source.config.kind!=='ifacialmocap')throw new Error('source');
 expect(defaultsFor(source).address).toBeNull();
 expect(changedFields({...source,config:{...source.config,phoneAddress:'192.168.1.20'}})).toEqual(new Set(['address']));
});
