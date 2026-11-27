import { expect, it } from 'vitest';
import { Color } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { DEFAULT_SNOW, type SceneEntity } from '@opensekai/contracts';
import { SNOW_LAYER, createSnowFlakes } from '../src/snow-flakes';
import { createSnowSky } from '../src/snow-sky';

const entity = (patch: object = {}, visible = true) => ({ id: 'snow_1', name: 'Snow', visible, transform: { position: [1, 2, -1], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [6, 4, 8] }, kind: 'snow', snow: { ...DEFAULT_SNOW, ...patch } }) as Extract<SceneEntity, { kind: 'snow' }>;
const make = () => createSnowFlakes(createSnowSky(64), uniform(new Color(1, 1, 1)), 12_000);

it('draws on the snow layer only, with no shadow and no depth write, as premultiplied alpha', () => {
    const { object } = make();
    expect(object.layers.mask).toBe(1 << SNOW_LAYER);
    expect(object.castShadow).toBe(false); expect(object.frustumCulled).toBe(false); expect(object.name).toBe('snow-flakes');
    expect(object.material).toMatchObject({ transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: true });
});
it('scales the flake count with the rate and hides with the entity', () => {
    const flakes = make();
    flakes.update(entity({ rate: 1 }), 0); expect(flakes.object.count).toBe(12_000); expect(flakes.object.visible).toBe(true);
    flakes.update(entity({ rate: 0.5 }), 0); expect(flakes.object.count).toBe(6_000);
    flakes.update(entity({ rate: 0 }), 0); expect(flakes.object.visible).toBe(false);
    flakes.update(entity({ rate: 1 }, false), 0); expect(flakes.object.visible).toBe(false);
});
it('takes the position and the yaw of the box and keeps a scale of 1', () => {
    const flakes = make();
    flakes.update(entity(), 0);
    expect(flakes.object.position.toArray()).toEqual([1, 2, -1]);
    expect(flakes.object.scale.toArray()).toEqual([1, 1, 1]);
    expect(flakes.object.quaternion.toArray().map(v => +v.toFixed(6))).toEqual([0, 0.707107, 0, 0.707107]);
});
