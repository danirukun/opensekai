import { describe, expect, it } from 'vitest';
import { LightSettingsSchema, PatchOpSchema, SceneEntitySchema, SceneViewSchema, makeSmokeScene, propertiesFor, readProperty, writeProperty, type LightSettings, type SceneEntity } from '../src/index';

const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'directional', color: '#ffffff', intensity: 3, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, ...patch });
const light = (id: string, patch: Partial<LightSettings> = {}): SceneEntity => ({ id, name: 'Light', visible: true, transform: { position: [2, 4, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const withLights = (lights: SceneEntity[]) => { const scene = makeSmokeScene(); scene.entities.push(...lights); return scene; };
const shadow = (enabled: boolean) => ({ shadow: { ...settings().shadow, enabled } });

describe('light settings (R1)', () => {
    it('accepts directional and point lights', () => {
        expect(SceneEntitySchema.safeParse(light('a')).success).toBe(true);
        expect(SceneEntitySchema.safeParse(light('b', { type: 'point', intensity: 20, range: 10 })).success).toBe(true);
    });
    it.each([
        ['an uppercase color', { color: '#FFFFFF' }],
        ['a short color', { color: '#fff' }],
        ['an intensity above 1000', { intensity: 1000.1 }],
        ['a negative intensity', { intensity: -1 }],
        ['a range above 1000', { range: 1001 }],
        ['an unknown type', { type: 'area' as never }],
        ['a shadow bias above 0.01', { shadow: { ...settings().shadow, bias: 0.02 } }],
        ['a shadow intensity above 1', { shadow: { ...settings().shadow, intensity: 1.5 } }],
        ['a negative normal bias', { shadow: { ...settings().shadow, normalBias: -0.1 } }],
    ])('rejects %s', (_, patch) => expect(LightSettingsSchema.safeParse(settings(patch as Partial<LightSettings>)).success).toBe(false));
    it('rejects an unknown light field', () => expect(LightSettingsSchema.safeParse({ ...settings(), cookie: true }).success).toBe(false));
});
describe('light budget (R2)', () => {
    it('accepts 8 lights with 2 shadows', () => expect(SceneViewSchema.safeParse(withLights(Array.from({ length: 8 }, (_, i) => light(`l${i}`, shadow(i < 2))))).success).toBe(true));
    it('rejects a ninth light', () => expect(SceneViewSchema.safeParse(withLights(Array.from({ length: 9 }, (_, i) => light(`l${i}`)))).success).toBe(false));
    it('rejects a third shadow light, hidden lights included', () => {
        const lights = Array.from({ length: 3 }, (_, i) => light(`l${i}`, shadow(true)));
        lights[2] = { ...lights[2]!, visible: false };
        expect(SceneViewSchema.safeParse(withLights(lights)).success).toBe(false);
    });
});
describe('environment reflections (R15)', () => {
    const environment = (extra: object) => ({ id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null, ...extra });
    it('accepts a missing field and values from 0 to 2', () => {
        for (const extra of [{}, { reflectionsIntensity: 0 }, { reflectionsIntensity: 2 }]) expect(SceneEntitySchema.safeParse(environment(extra)).success).toBe(true);
    });
    it('rejects values outside 0 to 2', () => {
        for (const value of [-0.1, 2.1]) expect(SceneEntitySchema.safeParse(environment({ reflectionsIntensity: value })).success).toBe(false);
    });
    it('parses both patch operations', () => {
        expect(PatchOpSchema.safeParse({ kind: 'setEnvironmentReflections', entityId: 'stage', reflectionsIntensity: 0.5 }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: 'setLight', entityId: 'l', light: settings() }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: 'setLight', entityId: 'l', light: { ...settings(), color: 'red' } }).success).toBe(false);
    });
});
describe('Blueprint property targets (R17)', () => {
    it('gives a light position, rotation, visible, and intensity, and no scale', () => {
        expect(propertiesFor('light').map(p => p.key)).toEqual(['position', 'rotation', 'visible', 'intensity']);
        expect(propertiesFor('camera').map(p => p.key)).not.toContain('intensity');
    });
    it('reads and writes intensity within 0 to 1000', () => {
        const entity = light('l');
        expect(readProperty(entity, 'intensity')).toBe(3);
        const written = writeProperty(entity, 'intensity', 12.5);
        expect(written.ok && written.data.kind === 'light' && written.data.light).toEqual(settings({ intensity: 12.5 }));
        expect(writeProperty(entity, 'intensity', 1001).ok).toBe(false);
        expect(writeProperty(entity, 'scale', [2, 2, 2]).ok).toBe(false);
    });
});
