import { expect, it } from 'vitest';
import { TRACKING_PRESETS, type SceneEntity, type SceneView, type TrackingConfig } from '@opensekai/contracts';
import { makeAuthoringEntity, makeEmptyScene } from '../src/editor/authoring';
import { bodyOptions, canContinue, changeFace, faceOptions, initialChoice, resolveSetup, showsHands, type SetupChoice } from '../src/editor/tracking-guide-setup';

type Avatar = Extract<SceneEntity, { kind: 'avatar' }>;
type Source = Extract<SceneEntity, { kind: 'tracking' }>;
const preset = (id: string) => TRACKING_PRESETS.find(p => p.id === id)!;
const source = (id: string, config: TrackingConfig): Source => ({ ...(makeAuthoringEntity(config.kind, id, []) as Source), config });
const avatar = (id: string, tracking?: Avatar['tracking']): Avatar => ({ ...(makeAuthoringEntity('character', id, []) as Avatar), tracking });
const sceneOf = (...entities: SceneEntity[]): SceneView => { const base = makeEmptyScene(); return { ...base, entities: [...base.entities, ...entities] }; };
const facekit = (enabled: boolean): TrackingConfig => ({ kind: 'facekit', enabled, deviceId: '' });
const choice = (face: SetupChoice['face'], body: SetupChoice['body'], hands = true): SetupChoice => ({ face, body, hands });

it('lists the face options in order, with FaceKit only on macOS', () => {
 const scene = sceneOf(avatar('a'));
 expect(faceOptions(true, scene, 'a').map(o => [o.value, o.label])).toEqual([['webcam', 'Webcam'], ['facekit', 'FaceKit'], ['ifacialmocap', 'iFacialMocap'], ['selfreflect', 'SelfReflect'], ['vmc', 'Other VMC app'], ['openseeface', 'OpenSeeFace'], ['none', 'None']]);
 expect(faceOptions(false, scene, 'a').map(o => o.value)).toEqual(['webcam', 'ifacialmocap', 'selfreflect', 'vmc', 'openseeface', 'none']);
 expect(faceOptions(true, scene, 'a').every(o => !o.disabled)).toBe(true);
});

it('disables FaceKit when the other character binds an enabled FaceKit source', () => {
 const disabled = (scene: SceneView, id: string) => faceOptions(true, scene, id).find(o => o.value === 'facekit')!.disabled;
 const held = sceneOf(source('fk', facekit(true)), avatar('a', { bodySourceId: null, faceSourceId: 'fk' }), avatar('b'));
 expect(disabled(held, 'b')).toBe(true);
 expect(disabled(held, 'a')).toBe(false);
 const off = sceneOf(source('fk', facekit(false)), avatar('a', { bodySourceId: null, faceSourceId: 'fk' }), avatar('b'));
 expect(disabled(off, 'b')).toBe(false);
 const unbound = sceneOf(source('fk', facekit(true)), avatar('a'), avatar('b'));
 expect(disabled(unbound, 'b')).toBe(false);
});

it('lists the body options in order; Same as face is off for a face-only or empty face', () => {
 expect(bodyOptions('webcam').map(o => [o.value, o.label, o.disabled])).toEqual([['same', 'Same as face', false], ['webcam', 'Webcam', false], ['selfreflect', 'SelfReflect', false], ['vmc', 'Other VMC app', false], ['none', 'None', false]]);
 for (const face of ['facekit', 'ifacialmocap', 'openseeface', 'none'] as const) expect(bodyOptions(face)[0]!.disabled).toBe(true);
 for (const face of ['webcam', 'selfreflect', 'vmc'] as const) expect(bodyOptions(face)[0]!.disabled).toBe(false);
});

it('changeFace sets Body to None when Same as face no longer applies; other Body values stay', () => {
 expect(changeFace(choice('webcam', 'same'), 'ifacialmocap')).toEqual(choice('ifacialmocap', 'none'));
 expect(changeFace(choice('webcam', 'same'), 'none')).toEqual(choice('none', 'none'));
 expect(changeFace(choice('webcam', 'same'), 'selfreflect')).toEqual(choice('selfreflect', 'same'));
 expect(changeFace(choice('webcam', 'selfreflect'), 'facekit')).toEqual(choice('facekit', 'selfreflect'));
 expect(changeFace(choice('vmc', 'webcam', false), 'openseeface')).toEqual(choice('openseeface', 'webcam', false));
});

it('shows Hands only when the body resolves to the webcam', () => {
 expect(showsHands(choice('facekit', 'webcam'))).toBe(true);
 expect(showsHands(choice('webcam', 'same'))).toBe(true);
 expect(showsHands(choice('selfreflect', 'same'))).toBe(false);
 expect(showsHands(choice('webcam', 'selfreflect'))).toBe(false);
 expect(showsHands(choice('webcam', 'none'))).toBe(false);
});

it('continues unless Face and Body are both None', () => {
 const faces = faceOptions(true, sceneOf(avatar('a')), 'a');
 const go = (c: SetupChoice) => canContinue(c, faces, bodyOptions(c.face));
 expect(go(choice('none', 'none'))).toBe(false);
 expect(go(choice('none', 'vmc'))).toBe(true);
 expect(go(choice('openseeface', 'none'))).toBe(true);
});

it('does not continue with a disabled option or an option that the list does not offer', () => {
 const held = sceneOf(source('fk', facekit(true)), avatar('a', { bodySourceId: null, faceSourceId: 'fk' }), avatar('b'));
 expect(canContinue(choice('facekit', 'none'), faceOptions(true, held, 'b'), bodyOptions('facekit'))).toBe(false);
 expect(canContinue(choice('facekit', 'none'), faceOptions(true, held, 'a'), bodyOptions('facekit'))).toBe(true);
 expect(canContinue(choice('facekit', 'webcam'), faceOptions(false, held, 'a'), bodyOptions('facekit'))).toBe(false);
 expect(canContinue(choice('ifacialmocap', 'same'), faceOptions(true, held, 'a'), bodyOptions('ifacialmocap'))).toBe(false);
});

it('initialChoice gives None for a FaceKit face when the platform is not macOS', () => {
 const scene = sceneOf(source('f', facekit(true)), source('w', preset('webcam').config), avatar('a', { bodySourceId: 'w', faceSourceId: 'f', fingersSourceId: 'w' }));
 expect(initialChoice(scene, 'a', false)).toEqual(choice('none', 'webcam', true));
 expect(initialChoice(scene, 'a', true)).toEqual(choice('facekit', 'webcam', true));
});

it('initialChoice turns Hands on when the character binds no webcam source', () => {
 const other = preset('vmc').config;
 expect(initialChoice(sceneOf(source('v', other), avatar('a', { bodySourceId: 'v', faceSourceId: 'v', fingersSourceId: null })), 'a', true).hands).toBe(true);
});

it('initialChoice: Webcam, Same as face, Hands on for a character with no face and no body source', () => {
 expect(initialChoice(sceneOf(avatar('a')), 'a', true)).toEqual(choice('webcam', 'same', true));
 expect(initialChoice(sceneOf(avatar('a', undefined)), 'a', true)).toEqual(choice('webcam', 'same', true));
 expect(initialChoice(sceneOf(), 'a', true)).toEqual(choice('webcam', 'same', true));
});

it('initialChoice reads the bindings', () => {
 const reflect = preset('selfreflect').config, other = preset('vmc').config;
 expect(initialChoice(sceneOf(source('v', reflect), avatar('a', { bodySourceId: 'v', faceSourceId: 'v', fingersSourceId: 'v' })), 'a', true)).toMatchObject({ face: 'selfreflect', body: 'same' });
 expect(initialChoice(sceneOf(source('v', other), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' })), 'a', true)).toMatchObject({ face: 'vmc', body: 'same' });
 expect(initialChoice(sceneOf(source('i', preset('ifacialmocap').config), source('v', other), avatar('a', { bodySourceId: 'v', faceSourceId: 'i', fingersSourceId: 'v' })), 'a', true)).toMatchObject({ face: 'ifacialmocap', body: 'vmc' });
 const webcam = preset('webcam').config;
 expect(initialChoice(sceneOf(source('w', webcam), avatar('a', { bodySourceId: 'w', faceSourceId: null, fingersSourceId: null })), 'a', true)).toEqual(choice('none', 'webcam', false));
 expect(initialChoice(sceneOf(source('w', webcam), avatar('a', { bodySourceId: 'w', faceSourceId: 'w', fingersSourceId: 'w' })), 'a', true)).toEqual(choice('webcam', 'same', true));
 expect(initialChoice(sceneOf(source('f', facekit(true)), avatar('a', { bodySourceId: null, faceSourceId: 'f' })), 'a', true)).toMatchObject({ face: 'facekit', body: 'none' });
 expect(initialChoice(sceneOf(source('o', preset('openseeface').config), avatar('a', { bodySourceId: null, faceSourceId: 'o' })), 'a', true)).toMatchObject({ face: 'openseeface', body: 'none' });
});

const kinds = (c: SetupChoice) => resolveSetup(c).map(p => [p.preset.id, p.roles]);

it('resolveSetup: one webcam part for Webcam and Same as face, with the hands channel from the checkbox', () => {
 const on = resolveSetup(choice('webcam', 'same', true));
 expect(on.map(p => [p.preset.id, p.roles])).toEqual([['webcam', ['face', 'body', 'fingers']]]);
 expect(on[0]!.config).toMatchObject({ kind: 'mediapipe', face: true, upperBody: true, hands: true });
 const off = resolveSetup(choice('webcam', 'same', false));
 expect(off.map(p => p.roles)).toEqual([['face', 'body']]);
 expect(off[0]!.config).toMatchObject({ face: true, upperBody: true, hands: false });
 expect(kinds(choice('webcam', 'webcam', true))).toEqual([['webcam', ['face', 'body', 'fingers']]]);
});

it('resolveSetup: two parts for a face-only face and a body source, face first', () => {
 const parts = resolveSetup(choice('facekit', 'webcam', true));
 expect(parts.map(p => [p.preset.id, p.roles])).toEqual([['facekit', ['face']], ['webcam', ['body', 'fingers']]]);
 expect(parts[1]!.config).toMatchObject({ face: false, upperBody: true, hands: true });
 expect(kinds(choice('ifacialmocap', 'selfreflect'))).toEqual([['ifacialmocap', ['face']], ['selfreflect', ['body', 'fingers']]]);
 expect(kinds(choice('vmc', 'selfreflect'))).toEqual([['vmc', ['face']], ['selfreflect', ['body', 'fingers']]]);
 expect(kinds(choice('selfreflect', 'same'))).toEqual([['selfreflect', ['face', 'body', 'fingers']]]);
});

it('resolveSetup: one part when only one side has a source; nothing for None and None', () => {
 expect(kinds(choice('none', 'vmc'))).toEqual([['vmc', ['body', 'fingers']]]);
 expect(kinds(choice('openseeface', 'none'))).toEqual([['openseeface', ['face']]]);
 expect(resolveSetup(choice('openseeface', 'none'))[0]!.config).toEqual(preset('openseeface').config);
 expect(kinds(choice('webcam', 'none'))).toEqual([['webcam', ['face']]]);
 expect(resolveSetup(choice('webcam', 'none'))[0]!.config).toMatchObject({ face: true, upperBody: false, hands: false });
 expect(kinds(choice('none', 'webcam', false))).toEqual([['webcam', ['body']]]);
 expect(resolveSetup(choice('none', 'none'))).toEqual([]);
});
