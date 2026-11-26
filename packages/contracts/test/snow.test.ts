import { expect, it } from 'vitest';
import { DEFAULT_SNOW, LIMITS, PatchOpSchema, SceneViewSchema, SnowSettingsSchema, makeSmokeScene, type SceneEntity } from '@opensekai/contracts';

const snow = (id: string, patch: object = {}): SceneEntity => ({ id, name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW, ...patch } } as SceneEntity);

it('has the defaults of the design', () => {
    expect(DEFAULT_SNOW).toEqual({ rate: 0.5, fallSpeed: 1, flakeSize: 1, flutter: 1, windDirection: 0, windSpeed: 0, buildUpSeconds: 45, meltSeconds: 20, thickness: 0.015, settleOnCharacters: true, settleOnProps: true, settleOnEnvironment: true });
    expect(SnowSettingsSchema.safeParse(DEFAULT_SNOW).success).toBe(true);
});
it.each([['rate', -0.1], ['rate', 1.1], ['fallSpeed', 0.1], ['fallSpeed', 3.1], ['flakeSize', 0.4], ['flakeSize', 2.1], ['flutter', 2.1], ['windDirection', 361], ['windSpeed', 5.1], ['buildUpSeconds', 4], ['buildUpSeconds', 601], ['meltSeconds', 4], ['meltSeconds', 601], ['thickness', 0.06], ['settleOnProps', 1]])('rejects %s = %s', (key, value) => {
    expect(SnowSettingsSchema.safeParse({ ...DEFAULT_SNOW, [key]: value }).success).toBe(false);
});
it('rejects an unknown field', () => expect(SnowSettingsSchema.safeParse({ ...DEFAULT_SNOW, color: '#fff' }).success).toBe(false));
it('allows one snow in a scene and rejects two', () => {
    const scene = makeSmokeScene();
    expect(LIMITS.snows).toBe(1);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, snow('snow_1')] }).success).toBe(true);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, snow('snow_1'), snow('snow_2')] }).success).toBe(false);
});
it('parses setSnow and rejects a bad group', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setSnow', entityId: 'snow_1', snow: DEFAULT_SNOW }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setSnow', entityId: 'snow_1', snow: { ...DEFAULT_SNOW, thickness: 1 } }).success).toBe(false);
});
