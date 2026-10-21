import { describe, expect, it } from 'vitest';
import { HazeSettingsSchema, LIMITS, LightSettingsSchema, PatchOpSchema, SceneEntitySchema, SceneViewSchema, makeSmokeScene, propertiesFor, readProperty, writeProperty, type HazeSettings, type LightSettings, type SceneEntity } from '../src/index';

const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const spot = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'spot', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, cone: { angleDegrees: 40, penumbra: 0.3 }, volumetric: true, ...patch });
const plain = (type: LightSettings['type'], patch: Partial<LightSettings> = {}): LightSettings => { const { cone: _, volumetric: __, ...rest } = spot(); return { ...rest, type, ...patch }; };
const light = (id: string, settings: LightSettings): SceneEntity => ({ id, name: 'Light', visible: true, transform: { position: [0, 3, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings });
const hazeSettings = (patch: Partial<HazeSettings> = {}): HazeSettings => ({ density: 1, smoke: 1, intensity: 1, drift: 0.2, ...patch });
const haze = (id: string, patch: Partial<HazeSettings> = {}): SceneEntity => ({ id, name: 'Haze', visible: true, transform: { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] }, kind: 'haze', haze: hazeSettings(patch) });
const withEntities = (entities: SceneEntity[]) => { const scene = makeSmokeScene(); scene.entities.push(...entities); return scene; };
const accepts = (settings: unknown) => LightSettingsSchema.safeParse(settings).success;

describe('spot and ambient lights (R1)', () => {
    it('accepts a spot light with a cone and a volumetric flag', () => {
        expect(SceneEntitySchema.safeParse(light('s', spot())).success).toBe(true);
        expect(accepts(spot({ cone: { angleDegrees: 1, penumbra: 0 } }))).toBe(true);
        expect(accepts(spot({ cone: { angleDegrees: 170, penumbra: 1 } }))).toBe(true);
    });
    it('rejects a spot light without a cone', () => expect(accepts(plain('spot'))).toBe(false));
    it.each([
        ['an angle below 1', { angleDegrees: 0.5, penumbra: 0.3 }],
        ['an angle above 170', { angleDegrees: 171, penumbra: 0.3 }],
        ['a negative penumbra', { angleDegrees: 40, penumbra: -0.1 }],
        ['a penumbra above 1', { angleDegrees: 40, penumbra: 1.1 }],
        ['a missing penumbra', { angleDegrees: 40 }],
        ['an unknown cone field', { angleDegrees: 40, penumbra: 0.3, cookie: true }],
        ['a null cone', null],
    ])('rejects a cone with %s', (_, cone) => expect(accepts({ ...spot(), cone })).toBe(false));
    it('ignores a cone on another type, but checks its ranges', () => {
        expect(accepts(plain('point', { cone: { angleDegrees: 40, penumbra: 0.3 } }))).toBe(true);
        expect(accepts(plain('point', { cone: { angleDegrees: 171, penumbra: 0.3 } }))).toBe(false);
    });
    it('accepts an ambient light only with the shadow off', () => {
        expect(accepts(plain('ambient', { intensity: 0.3 }))).toBe(true);
        expect(accepts(plain('ambient', { shadow: { ...shadow, enabled: true } }))).toBe(false);
    });
    it('accepts volumetric only on point and spot lights', () => {
        expect(accepts(plain('point', { volumetric: true }))).toBe(true);
        expect(accepts(plain('directional', { volumetric: true }))).toBe(false);
        expect(accepts(plain('ambient', { volumetric: true }))).toBe(false);
        expect(accepts(plain('directional', { volumetric: false }))).toBe(true);
    });
    it('keeps a B9 light without cone and volumetric unchanged', () => {
        const parsed = LightSettingsSchema.parse(plain('directional'));
        expect('cone' in parsed || 'volumetric' in parsed).toBe(false);
    });
});
describe('haze entity (R6)', () => {
    it('accepts one haze and its value ranges', () => {
        expect(SceneViewSchema.safeParse(withEntities([haze('fog')])).success).toBe(true);
        expect(HazeSettingsSchema.safeParse({ density: 2, smoke: 3, intensity: 4, drift: 2 }).success).toBe(true);
        expect(HazeSettingsSchema.safeParse({ density: 0, smoke: 0, intensity: 0, drift: 0 }).success).toBe(true);
    });
    it.each([
        ['a density above 2', { density: 2.1 }],
        ['a negative density', { density: -0.1 }],
        ['a smoke above 3', { smoke: 3.1 }],
        ['an intensity above 4', { intensity: 4.1 }],
        ['a drift above 2', { drift: 2.1 }],
        ['an infinite drift', { drift: Infinity }],
    ])('rejects %s', (_, patch) => expect(HazeSettingsSchema.safeParse(hazeSettings(patch)).success).toBe(false));
    it('rejects an unknown haze field and a missing field', () => {
        expect(HazeSettingsSchema.safeParse({ ...hazeSettings(), color: '#ffffff' }).success).toBe(false);
        const { drift: _, ...missing } = hazeSettings();
        expect(HazeSettingsSchema.safeParse(missing).success).toBe(false);
    });
    it('rejects a second haze, hidden or not', () => {
        expect(LIMITS.hazes).toBe(1);
        expect(SceneViewSchema.safeParse(withEntities([haze('a'), { ...haze('b'), visible: false }])).success).toBe(false);
    });
    it('does not count a haze as a light (R2)', () => {
        const lights = Array.from({ length: 8 }, (_, i) => light(`l${i}`, spot()));
        expect(SceneViewSchema.safeParse(withEntities([...lights, haze('fog')])).success).toBe(true);
    });
    it('parses setHaze and rejects a bad group', () => {
        expect(PatchOpSchema.safeParse({ kind: 'setHaze', entityId: 'fog', haze: hazeSettings() }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: 'setHaze', entityId: 'fog', haze: hazeSettings({ intensity: 5 }) }).success).toBe(false);
        expect(PatchOpSchema.safeParse({ kind: 'setLight', entityId: 'l', light: plain('spot') }).success).toBe(false);
    });
});
describe('Blueprint property targets (R14)', () => {
    it('gives a haze position, rotation, scale, visible, and haze density', () => {
        expect(propertiesFor('haze').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible', 'hazeDensity']);
        expect(propertiesFor('light').map(p => p.key)).not.toContain('hazeDensity');
    });
    it('gives an FPS counter the visible target only (B19 R12)', () => {
        expect(propertiesFor('fpsCounter').map(p => p.key)).toEqual(['visible']);
    });
    it('reads and writes haze density within 0 to 2', () => {
        const entity = haze('fog');
        expect(readProperty(entity, 'hazeDensity')).toBe(1);
        expect(readProperty(light('l', spot()), 'hazeDensity')).toBeUndefined();
        const written = writeProperty(entity, 'hazeDensity', 1.5);
        expect(written.ok && written.data.kind === 'haze' && written.data.haze).toEqual(hazeSettings({ density: 1.5 }));
        expect(writeProperty(entity, 'hazeDensity', 2.1).ok).toBe(false);
        expect(writeProperty(light('l', spot()), 'hazeDensity', 1).ok).toBe(false);
        expect(writeProperty(entity, 'scale', [10, 4, 10]).ok).toBe(true);
    });
    it('writes intensity on all four light types', () => {
        for (const settings of [plain('directional'), plain('point'), spot(), plain('ambient')]) {
            const written = writeProperty(light('l', settings), 'intensity', 7);
            expect(written.ok && written.data.kind === 'light' && written.data.light).toEqual({ ...settings, intensity: 7 });
        }
    });
});
