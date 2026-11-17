import { describe, expect, it } from 'vitest';
import { LIGHT_BUDGET_MESSAGES, LIMITS, SceneViewSchema, isLightBudgetMessage, isLitLight, lightBudgetError, makeSmokeScene, validateCall, type LightSettings, type SceneEntity } from '../src/index';

const M = LIGHT_BUDGET_MESSAGES;
const base: LightSettings = { type: 'point', color: '#ffffff', intensity: 3, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } };
const unlitFlags = { affectCharacters: false, affectProps: false, affectEnvironment: false };
const light = (id: string, patch: Partial<LightSettings> = {}, visible = true): SceneEntity => ({ id, name: 'Light', visible, transform: { position: [0, 3, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: { ...base, ...patch } });
const shadow = { shadow: { ...base.shadow, enabled: true } };
const lit = (count: number, prefix = 'lit') => Array.from({ length: count }, (_, i) => light(`${prefix}_${i}`));
const unlit = (count: number, prefix = 'unlit') => Array.from({ length: count }, (_, i) => light(`${prefix}_${i}`, unlitFlags));
const scene = (lights: SceneEntity[]) => { const value = makeSmokeScene(); value.entities.push(...lights); return value; };
const messages = (lights: SceneEntity[]) => { const parsed = SceneViewSchema.safeParse(scene(lights)); return parsed.success ? [] : parsed.error.issues.map(issue => issue.message); };

describe('light limits (R1–R3)', () => {
    it('counts a light as lit when one affect flag is on', () => {
        const types: LightSettings['type'][] = ['directional', 'point', 'spot', 'ambient'];
        for (const type of types) {
            const settings: LightSettings = { ...base, type, ...(type === 'spot' ? { cone: { angleDegrees: 30, penumbra: 0.2 } } : {}) };
            expect(isLitLight({ ...settings, ...unlitFlags })).toBe(false);
            for (const flag of ['affectCharacters', 'affectProps', 'affectEnvironment'] as const) expect(isLitLight({ ...settings, ...unlitFlags, [flag]: true })).toBe(true);
            const extras = type === 'spot' ? { volumetric: true, beam: { enabled: true, intensity: 1, softness: 0.5 } } : {};
            const beamOnly: LightSettings = { ...settings, ...unlitFlags, ...extras, shadow: { ...base.shadow, enabled: type !== 'ambient' } };
            expect(isLitLight(beamOnly)).toBe(false);
        }
        expect(LIMITS.lights).toBe(32);
        expect(LIMITS.litLights).toBe(8);
    });
    it('accepts 8 lit and 24 unlit lights with 2 shadow lights and hidden lights', () => {
        const lights = [...lit(8), ...unlit(24)];
        lights[0] = light('lit_0', shadow);
        lights[8] = light('unlit_0', { ...unlitFlags, ...shadow });
        lights[1] = light('lit_1', {}, false);
        lights[9] = light('unlit_1', unlitFlags, false);
        expect(SceneViewSchema.safeParse(scene(lights)).success).toBe(true);
        expect(lightBudgetError(scene(lights).entities)).toBeNull();
    });
    it('refuses a ninth lit light, hidden lit lights included', () => {
        const lights = [...lit(8), light('hidden', {}, false), ...unlit(23)];
        expect(messages(lights)).toContain(M.litLights);
        expect(isLightBudgetMessage(M.litLights)).toBe(true);
    });
    it('refuses a 33rd light', () => expect(messages([...lit(8), ...unlit(25)])).toContain(M.lights));
    it('refuses a third shadow light when all shadow lights are unlit', () => {
        const lights = Array.from({ length: 3 }, (_, i) => light(`s${i}`, { ...unlitFlags, ...shadow }));
        expect(messages(lights)).toContain(M.shadowLights);
    });
    it('reports the first broken limit in the order lights, lit lights, shadow lights', () => {
        const shadowed = (count: number) => Array.from({ length: count }, (_, i) => light(`shadow_${i}`, shadow));
        const all = [...shadowed(3), ...lit(6), ...unlit(24)];
        expect(lightBudgetError(scene(all).entities)).toBe(M.lights);
        expect(messages(all).filter(isLightBudgetMessage)).toEqual([M.lights]);
        const nine = [...shadowed(3), ...lit(6)];
        expect(lightBudgetError(scene(nine).entities)).toBe(M.litLights);
        expect(messages(nine).filter(isLightBudgetMessage)).toEqual([M.litLights]);
        expect(isLightBudgetMessage('Invalid show scene')).toBe(false);
    });
    it('gives the budget message from validateCall for sceneReplace', () => {
        expect(validateCall('sceneReplace', { scene: scene(lit(9)), expectedRevision: 0 })).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: M.litLights, ids: [] } });
        expect(validateCall('sceneReplace', { scene: scene([...lit(8), ...unlit(24)]), expectedRevision: 0 }).ok).toBe(true);
    });
});
