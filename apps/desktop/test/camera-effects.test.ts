import { expect, it, vi } from 'vitest';
import { DEFAULT_CAMERA_EFFECTS as D, makeSmokeScene, type AppApi, type AssetRecord, type CameraEffects, type Reply, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '@opensekai/session';
import { makeAuthoringEntity } from '../src/editor/authoring';
import { sectionsFor } from '../src/editor/inspector-sections';
import { effectValues, shownEffectFields, withEffect, withLensDirt } from '../src/editor/camera-effects';
import { changedFields, defaultsFor, resetFieldIds } from '../src/editor/property-defaults';
import { imageSourceOptions } from '../src/editor/screen';
import { SLIDERS } from '../src/editor/slider';
import { createEditorModel } from '../src/editor/model';

const camera = (effects?: CameraEffects): SceneEntity => {
 const added = makeAuthoringEntity('camera', 'camera_fx', []);
 return effects ? { ...added, effects } as SceneEntity : added;
};
const VALUE_FIELDS = ['lensDirtIntensity', 'lensDirtThreshold', 'vignettingColor', 'vignettingAlpha', 'vignettingFadeOut', 'vignettingBlink', 'nightVisionColor', 'nightVisionAlpha', 'blurIntensity', 'pixelateIntensity'];

it('puts the effects section directly after grading (R25)', () => {
 const ids = sectionsFor(camera(), { expressions: false }).map(section => section.id);
 expect(ids.slice(ids.indexOf('grading'), ids.indexOf('grading') + 2)).toEqual(['grading', 'effects']);
});

it('writes the defaults with enabled on a first check, and changes one field after that (R28)', () => {
 for (const [id, name] of [['vignetting', 'vignetting'], ['nightVision', 'nightVision'], ['blur', 'blur'], ['pixelate', 'pixelate']] as const)
  expect(withEffect(undefined, id, true)).toEqual({ [name]: { ...D[name], enabled: true } });
 const on = withEffect(withEffect(undefined, 'blur', true), 'blurIntensity', 2.5);
 expect(on).toEqual({ blur: { enabled: true, intensity: 2.5 } });
 expect(withEffect(on, 'blur', false)).toEqual({ blur: { enabled: false, intensity: 2.5 } });
 const both = withEffect(on, 'vignettingColor', '#102030');
 expect(both).toEqual({ blur: { enabled: true, intensity: 2.5 }, vignetting: { ...D.vignetting, color: '#102030' } });
 expect(on).toEqual({ blur: { enabled: true, intensity: 2.5 } });
});

it('gives the dirt defaults to a first image and keeps the numbers on None (R27)', () => {
 const first = withLensDirt(undefined, 'image_dirt');
 expect(first).toEqual({ lensDirt: { assetId: 'image_dirt', intensity: 0.9, threshold: 0.5 } });
 const tuned = withEffect(first, 'lensDirtIntensity', 0.3);
 expect(withLensDirt(tuned, null)).toEqual({ lensDirt: { assetId: null, intensity: 0.3, threshold: 0.5 } });
});

it('shows a value field as a reset field only while its effect is on (R30)', () => {
 const effectFields = (entity: SceneEntity) => resetFieldIds(entity).filter(id => id in effectValues());
 expect(effectFields(camera())).toEqual(['lensDirt', 'vignetting', 'nightVision', 'blur', 'pixelate']);
 expect(effectFields(camera({ blur: { enabled: true, intensity: 1 } }))).toContain('blurIntensity');
 expect(effectFields(camera({ blur: { enabled: false, intensity: 3 } }))).not.toContain('blurIntensity');
 expect(effectFields(camera({ lensDirt: { ...D.lensDirt, assetId: 'image_dirt' } }))).toEqual(['lensDirt', 'lensDirtIntensity', 'lensDirtThreshold', 'vignetting', 'nightVision', 'blur', 'pixelate']);
 const all: CameraEffects = { vignetting: { ...D.vignetting, enabled: true }, nightVision: { ...D.nightVision, enabled: true }, blur: { ...D.blur, enabled: true }, pixelate: { ...D.pixelate, enabled: true }, lensDirt: { ...D.lensDirt, assetId: 'image_dirt' } };
 expect(shownEffectFields(all).filter(id => VALUE_FIELDS.includes(id))).toEqual(VALUE_FIELDS);
 expect(effectFields(camera(all))).toHaveLength(15);
});

it('resets to the defaults and marks a changed effect (R30)', () => {
 const defaults = defaultsFor(camera());
 expect(defaults).toMatchObject({ lensDirt: null, lensDirtIntensity: 0.9, lensDirtThreshold: 0.5, vignetting: false, vignettingColor: '#4c4c4c', vignettingAlpha: 0.051, vignettingFadeOut: 0, vignettingBlink: 0, nightVision: false, nightVisionColor: '#80ff80', nightVisionAlpha: 0.502, blur: false, blurIntensity: 1, pixelate: false, pixelateIntensity: 16 });
 expect([...changedFields(camera())].filter(id => id in effectValues())).toEqual([]);
 expect(changedFields(camera({ blur: { enabled: true, intensity: 1 } })).has('blur')).toBe(true);
 expect(changedFields(camera({ blur: { enabled: true, intensity: 1 } })).has('blurIntensity')).toBe(false);
 expect(changedFields(camera({ blur: { enabled: true, intensity: 2 } })).has('blurIntensity')).toBe(true);
 expect(changedFields(camera({ blur: { enabled: false, intensity: 2 } })).has('blurIntensity')).toBe(false);
});

it('labels the empty row of the image select', () => {
 const assets = [{ id: 'image_a', name: 'Dirt', kind: 'image', mediaType: 'image/png' }] as unknown as AssetRecord[];
 expect(imageSourceOptions(null, assets, 'None')[0]).toEqual({ value: '', label: 'None' });
 expect(imageSourceOptions(null, assets)[0]).toEqual({ value: '', label: 'Choose image…' });
});

it('gives each slider the range of its L row', () => {
 expect(SLIDERS.lensDirtIntensity).toMatchObject({ min: 0, max: 1, step: 0.01 });
 expect(SLIDERS.lensDirtThreshold).toMatchObject({ min: 0, max: 1, step: 0.01 });
 expect(SLIDERS.vignettingAlpha).toMatchObject({ min: 0, max: 1, step: 0.001 });
 expect(SLIDERS.vignettingFadeOut).toMatchObject({ min: 0, max: 1, step: 0.01 });
 expect(SLIDERS.vignettingBlink).toMatchObject({ min: 0, max: 1, step: 0.01 });
 expect(SLIDERS.nightVisionAlpha).toMatchObject({ min: 0, max: 1, step: 0.001 });
 expect(SLIDERS.blurIntensity).toMatchObject({ min: 0, max: 4, step: 0.01 });
 expect(SLIDERS.pixelateIntensity).toMatchObject({ min: 1, max: 256, step: 1 });
});

it('sets and removes the effects through the model, and refuses a bad value or another kind', async () => {
 const session = createSession(makeSmokeScene(), 'test_session');
 const unsupported = async (): Promise<Reply<never>> => ({ ok: false, error: { code: 'UNSUPPORTED', message: 'Unsupported', ids: [] } });
 const api = { appStatus: unsupported, sceneInspect: vi.fn(async () => ({ ok: true as const, data: session.inspect() })), scenePatch: vi.fn(async params => session.applyPatch(params)) } as unknown as AppApi;
 const model = createEditorModel(api);
 await model.load();
 const effects = withEffect(undefined, 'pixelate', true);
 expect(await model.setCameraEffects('camera_wide', effects)).toMatchObject({ ok: true });
 expect(session.inspect().entities.find(entity => entity.id === 'camera_wide')).toMatchObject({ effects });
 expect(await model.setCameraEffects('camera_wide', withEffect(effects, 'pixelateIntensity', 0.5))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(await model.setCameraEffects('performer', effects)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(await model.setCameraEffects('camera_wide', null)).toMatchObject({ ok: true });
 expect(session.inspect().entities.find(entity => entity.id === 'camera_wide')).not.toHaveProperty('effects');
 expect(api.scenePatch).toHaveBeenCalledTimes(2);
});
