import { describe, expect, it } from 'vitest';
import { StorageBufferAttribute } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes';
import { LilToonNodeMaterial } from '@mochiya/three-liltoon/webgpu';
import { CharacterLilToonMaterial } from '../src/character-liltoon';
import { CharacterMToonMaterial } from '../src/character-mtoon';
import { createSnowNoise, snowColorEligible, snowPushEligible, type SnowShare } from '../src/snow-surface';

const share = (): SnowShare => ({ state: new StorageBufferAttribute(new Float32Array(12), 4), count: 3, thickness: uniform(0.015), noise: createSnowNoise() });
type Snowy = CharacterMToonMaterial | CharacterLilToonMaterial;
const key = (material: Snowy) => material.customProgramCacheKey();
const kinds = [
    { name: 'MToon', make: (): Snowy => new CharacterMToonMaterial(), parentKey: (material: Snowy) => MToonNodeMaterial.prototype.customProgramCacheKey.call(material) },
    // The parent key of a lilToon material without a character share ends with the empty share flag.
    { name: 'lilToon', make: (): Snowy => new CharacterLilToonMaterial(), parentKey: (material: Snowy) => LilToonNodeMaterial.prototype.customProgramCacheKey.call(material) + '|' },
];

describe.each(kinds)('a character $name material', ({ make, parentKey }) => {
    it('keeps the program key of a material without snow', () => {
        const material = make();
        expect(material.snow).toBeNull();
        expect(key(material)).toBe(parentKey(material));
    });
    it('changes the program key when the material gets a share, and gives it back when the share goes', () => {
        const material = make(), before = key(material);
        material.snow = share();
        expect(key(material)).not.toBe(before);
        material.snow = null;
        expect(key(material)).toBe(before);
    });
    // three.js keeps one node build for each cache key, and the build holds the storage buffer of its first material.
    it('gives two shares two program keys, and one share one key', () => {
        const [first, second, third] = [make(), make(), make()];
        first.snow = share();
        second.snow = share();
        third.snow = first.snow;
        expect(key(second)).not.toBe(key(first));
        expect(key(third)).toBe(key(first));
    });
    // An outline reads the amount in its vertex stage, so its key has the share too.
    it('keys an outline copy on the share, and not a blended material', () => {
        const outline = make(), blended = make();
        outline.isOutline = true;
        blended.transparent = true;
        const [outlineKey, blendedKey] = [key(outline), key(blended)];
        outline.snow = share();
        blended.snow = share();
        expect(key(outline)).not.toBe(outlineKey);
        expect(key(blended)).toBe(blendedKey);
    });
    it('copies the share with the material', () => {
        const material = make(), value = share();
        material.snow = value;
        expect(material.clone().snow).toBe(value);
    });
});
it('gives the push to an outline copy, the colour to a surface only, and no snow to a blended material', () => {
    expect(snowPushEligible({ transparent: false })).toBe(true);
    expect(snowPushEligible({ transparent: true })).toBe(false);
    expect(snowColorEligible({ isOutline: false, transparent: false })).toBe(true);
    expect(snowColorEligible({ isOutline: true, transparent: false })).toBe(false);
    expect(snowColorEligible({ isOutline: false, transparent: true })).toBe(false);
});
it('makes a small noise volume', () => expect(createSnowNoise().image).toMatchObject({ width: 32, height: 32, depth: 32 }));
