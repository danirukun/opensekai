// MToon UV animation from the session clock (MAT-01 slice 1, R5–R6).
import {MirroredRepeatWrapping, RepeatWrapping, type Texture} from 'three/webgpu';

export type UvSpeeds = {x: number; y: number; rotation: number};
export type UvWrap = {scroll: boolean; rotation: boolean};
export type UvValues = {scrollX: number; scrollY: number; rotation: number};
export type UvAnimated = {
    uvAnimationScrollXSpeedFactor: number; uvAnimationScrollYSpeedFactor: number; uvAnimationRotationSpeedFactor: number;
    uvAnimationScrollXOffset: number; uvAnimationScrollYOffset: number; uvAnimationRotationPhase: number;
    uvAnimationMaskTexture?: Texture | null;
};

const TAU = Math.PI * 2;
// Textures that the MToon shader samples through the animated UV. The matcap and the mask use the plain UV.
const ANIMATED_UV_TEXTURES = ['map', 'normalMap', 'emissiveMap', 'shadeMultiplyTexture', 'shadingShiftTexture', 'rimMultiplyTexture', 'outlineWidthMultiplyTexture'] as const;
const integer = (value: number) => Math.abs(value - Math.round(value)) < 1e-6;
const modulo = (value: number, period: number) => ((value % period) + period) % period;
// A scroll of 2 maps the texture onto itself only when 2 is a whole number of texture periods on the axis.
const keepsPeriod = (wrap: number, repeat: number) =>
    (wrap === RepeatWrapping && integer(2 * repeat)) || (wrap === MirroredRepeatWrapping && integer(repeat));

export function uvWrapPolicy(material: UvAnimated & Partial<Record<typeof ANIMATED_UV_TEXTURES[number], Texture | null>>): UvWrap {
    // The shader multiplies the scroll and the phase by the mask after this value, so a wrap would make a jump.
    if (material.uvAnimationMaskTexture) return {scroll: false, rotation: false};
    const scroll = ANIMATED_UV_TEXTURES.every(key => {
        const texture = material[key];
        return !texture || (keepsPeriod(texture.wrapS, texture.repeat.x) && keepsPeriod(texture.wrapT, texture.repeat.y));
    });
    return {scroll, rotation: true};
}

export function uvAnimationValues(speeds: UvSpeeds, wrap: UvWrap, t: number): UvValues {
    const scroll = (speed: number) => wrap.scroll ? modulo(speed * t, 2) : speed * t;
    return {scrollX: scroll(speeds.x), scrollY: scroll(speeds.y), rotation: wrap.rotation ? modulo(speeds.rotation * t, TAU) : speeds.rotation * t};
}

/** Binds the UV animation of a set of MToon materials; `apply` writes the values of one frame time. */
export function createUvAnimation(materials: readonly unknown[]) {
    const animated = materials.flatMap(value => {
        const material = value as UvAnimated;
        if (typeof material?.uvAnimationScrollXSpeedFactor !== 'number') return [];
        const speeds = {x: material.uvAnimationScrollXSpeedFactor, y: material.uvAnimationScrollYSpeedFactor, rotation: material.uvAnimationRotationSpeedFactor};
        if (speeds.x === 0 && speeds.y === 0 && speeds.rotation === 0) return [];
        return [{material, speeds, wrap: uvWrapPolicy(material)}];
    });
    return (elapsedMs: number) => {
        const t = elapsedMs / 1000;
        for (const {material, speeds, wrap} of animated) {
            const values = uvAnimationValues(speeds, wrap, t);
            material.uvAnimationScrollXOffset = values.scrollX;
            material.uvAnimationScrollYOffset = values.scrollY;
            material.uvAnimationRotationPhase = values.rotation;
        }
    };
}
