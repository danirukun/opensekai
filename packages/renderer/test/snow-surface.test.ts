import { expect, it } from 'vitest';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes';
import { CharacterMToonMaterial } from '../src/character-mtoon';
import { createSnowNoise, snowEligible, type SnowShare } from '../src/snow-surface';

const share = (): SnowShare => ({ state: new StorageBufferAttribute(new Float32Array(12), 4), count: 3, thickness: uniform(0.015), noise: createSnowNoise() });
const key = (material: CharacterMToonMaterial) => material.customProgramCacheKey();

it('keeps the program key of a material without snow', () => {
    const material = new CharacterMToonMaterial();
    expect(material.snow).toBeNull();
    expect(key(material)).toBe(MToonNodeMaterial.prototype.customProgramCacheKey.call(material));
});
it('changes the program key when the material gets a share, and gives it back when the share goes', () => {
    const material = new CharacterMToonMaterial(), before = key(material);
    material.snow = share();
    expect(key(material)).not.toBe(before);
    material.snow = null;
    expect(key(material)).toBe(before);
});
// three.js keeps one node build for each cache key, and the build holds the storage buffer of its first material.
it('gives two shares two program keys, and one share one key', () => {
    const [first, second, third] = [new CharacterMToonMaterial(), new CharacterMToonMaterial(), new CharacterMToonMaterial()];
    first.snow = share();
    second.snow = share();
    third.snow = first.snow;
    expect(key(second)).not.toBe(key(first));
    expect(key(third)).toBe(key(first));
});
it('gives no snow to an outline copy or to a blended material', () => {
    expect(snowEligible({ isOutline: false, transparent: false })).toBe(true);
    expect(snowEligible({ isOutline: true, transparent: false })).toBe(false);
    expect(snowEligible({ isOutline: false, transparent: true })).toBe(false);
    for (const flag of ['isOutline', 'transparent'] as const) {
        const material = new CharacterMToonMaterial();
        material[flag] = true;
        const before = key(material);
        material.snow = share();
        expect(key(material)).toBe(before);
    }
});
it('copies the share with the material', () => {
    const material = new CharacterMToonMaterial(), value = share();
    material.snow = value;
    expect(new CharacterMToonMaterial().copy(material).snow).toBe(value);
});
it('makes a small noise volume', () => expect(createSnowNoise().image).toMatchObject({ width: 32, height: 32, depth: 32 }));
