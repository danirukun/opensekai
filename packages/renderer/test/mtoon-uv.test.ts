import {describe, expect, it} from 'vitest';
import {ClampToEdgeWrapping, MirroredRepeatWrapping, RepeatWrapping, Texture, type Wrapping} from 'three/webgpu';
import {MToonNodeMaterial} from '@pixiv/three-vrm/nodes';
import {uvAnimationValues, uvWrapPolicy} from '../src/mtoon-uv';

const TAU = Math.PI * 2;
const texture = (wrap: Wrapping, repeat = 1) => { const value = new Texture(); value.wrapS = value.wrapT = wrap; value.repeat.set(repeat, repeat); return value; };
const material = (textures: Record<string, Texture>) => Object.assign(new MToonNodeMaterial(), textures);

describe('uvAnimationValues', () => {
    const wrap = {scroll: true, rotation: true};
    it('gives absolute values from the frame time', () => {
        expect(uvAnimationValues({x: 0.5, y: -0.25, rotation: 1}, {scroll: false, rotation: false}, 0)).toEqual({scrollX: 0, scrollY: -0, rotation: 0});
        expect(uvAnimationValues({x: 0.5, y: -0.25, rotation: 1}, {scroll: false, rotation: false}, 1.5)).toEqual({scrollX: 0.75, scrollY: -0.375, rotation: 1.5});
    });
    it('wraps the rotation into [0, 2π) and the scroll into [0, 2)', () => {
        const values = uvAnimationValues({x: 0.5, y: -0.25, rotation: 1}, wrap, 3600);
        expect(values.scrollX).toBeCloseTo(0);
        expect(values.scrollY).toBeCloseTo(0);
        expect(values.rotation).toBeCloseTo(3600 % TAU);
        const negative = uvAnimationValues({x: -0.3, y: 0, rotation: -1}, wrap, 1.5);
        expect(negative.scrollX).toBeCloseTo(1.55);
        expect(negative.rotation).toBeCloseTo(TAU - 1.5);
        for (const value of Object.values(negative)) expect(value).toBeGreaterThanOrEqual(0);
    });
    it('gives zero for zero speeds', () => {
        expect(uvAnimationValues({x: 0, y: 0, rotation: 0}, wrap, 3600)).toEqual({scrollX: 0, scrollY: 0, rotation: 0});
    });
});

describe('uvWrapPolicy', () => {
    it('does not wrap with a mask texture', () => {
        expect(uvWrapPolicy(material({uvAnimationMaskTexture: texture(RepeatWrapping)}))).toEqual({scroll: false, rotation: false});
    });
    it('wraps the scroll only when each animated-UV texture keeps a whole period over 2', () => {
        expect(uvWrapPolicy(material({}))).toEqual({scroll: true, rotation: true});
        expect(uvWrapPolicy(material({map: texture(RepeatWrapping, 1)})).scroll).toBe(true);
        expect(uvWrapPolicy(material({map: texture(RepeatWrapping, 0.5)})).scroll).toBe(true);
        expect(uvWrapPolicy(material({map: texture(MirroredRepeatWrapping, 1)})).scroll).toBe(true);
        expect(uvWrapPolicy(material({map: texture(ClampToEdgeWrapping)}))).toEqual({scroll: false, rotation: true});
        expect(uvWrapPolicy(material({map: texture(MirroredRepeatWrapping, 0.5)})).scroll).toBe(false);
        expect(uvWrapPolicy(material({map: texture(RepeatWrapping), rimMultiplyTexture: texture(RepeatWrapping, 0.3)})).scroll).toBe(false);
    });
    it('ignores the matcap texture', () => {
        expect(uvWrapPolicy(material({map: texture(RepeatWrapping), matcapTexture: texture(ClampToEdgeWrapping)})).scroll).toBe(true);
    });
});
