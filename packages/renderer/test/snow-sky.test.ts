import { expect, it } from 'vitest';
import { Matrix4, Mesh, Object3D, Vector3, Vector4 } from 'three/webgpu';
import type { SceneEntity } from '@opensekai/contracts';
import { DEFAULT_SNOW } from '@opensekai/contracts';
import { SNOW_SKY_LAYER, createSnowSky } from '../src/snow-sky';
import { skyMatrix } from '../src/snow-math';

const entity = (rotation = [0, 0, 0, 1]) => ({ id: 'snow_1', name: 'Snow', visible: true, transform: { position: [1, 2, -1], rotation, scale: [6, 4, 8] }, kind: 'snow', snow: { ...DEFAULT_SNOW } }) as Extract<SceneEntity, { kind: 'snow' }>;

it.each([[[0, 0, 0, 1]], [[0, Math.SQRT1_2, 0, Math.SQRT1_2]]])('frames the box so that a render-target lookup agrees with skyMatrix', rotation => {
    const sky = createSnowSky(64);
    sky.update(entity(rotation));
    const { camera } = sky;
    camera.updateMatrixWorld(true);
    const world = new Vector3(2.5, 3, -4);
    const ndc = world.clone().project(camera);
    // A render target is read with v = 1 − (ndc.y × 0.5 + 0.5), as the three.js shadow lookup does.
    const fromCamera = [ndc.x * 0.5 + 0.5, 1 - (ndc.y * 0.5 + 0.5)];
    const fromMatrix = new Vector4(world.x, world.y, world.z, 1).applyMatrix4(new Matrix4().fromArray(skyMatrix([1, 2, -1], rotation[1] === 0 ? 0 : Math.PI / 2, [6, 4, 8])));
    expect(fromCamera[0]).toBeCloseTo(fromMatrix.x, 5);
    expect(fromCamera[1]).toBeCloseTo(fromMatrix.y, 5);
    expect(camera.layers.mask).toBe(1 << SNOW_SKY_LAYER);
    expect(sky.matrix.value.toArray().map(v => +v.toFixed(6) + 0)).toEqual(skyMatrix([1, 2, -1], rotation[1] === 0 ? 0 : Math.PI / 2, [6, 4, 8]).map(v => +v.toFixed(6) + 0));
    sky.dispose();
});
it('marks each object under a caster root one time and leaves other layers on', () => {
    const sky = createSnowSky(64), root = new Object3D(), child = new Mesh();
    root.add(child);
    sky.markCasters([root]);
    expect(child.layers.isEnabled(SNOW_SKY_LAYER)).toBe(true); expect(child.layers.isEnabled(0)).toBe(true);
    child.layers.disable(SNOW_SKY_LAYER);
    sky.markCasters([root]);
    expect(child.layers.isEnabled(SNOW_SKY_LAYER)).toBe(false);
    sky.dispose();
});
