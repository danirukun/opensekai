import { Color, type Node, type UniformNode } from "three/webgpu";
import { Fn, acesFilmicToneMapping, luminance, max, neutralToneMapping, select, uniform, vec3, vec4, vibrance } from "three/tsl";
import { bloom as bloomNode } from "three/addons/tsl/display/BloomNode.js";
import type { CameraGrading, CameraToneMapping } from "@opensekai/contracts";
import { ALPHA_EPSILON, CONTRAST_FLOOR, CONTRAST_PIVOT } from "./grading-math";

type Vec4 = Node<"vec4">;
type Vec3 = Node<"vec3">;
type Float = Node<"float">;
type Curve = (color: Vec3, exposure: Float) => Vec3;

/**
 * Premultiplied-alpha composite of the scene and the bloom (CAM-06 R9): the bloom adds light, and its brightest
 * channel becomes coverage, so a glow over a transparent background stays a valid premultiplied pixel in OBS.
 */
export const bloomComposite = (scene: Vec4, bloom: Vec4): Vec4 => {
    const coverage = max(bloom.r, max(bloom.g, bloom.b)).saturate();
    return vec4(scene.rgb.add(bloom.rgb), scene.a.add(scene.a.oneMinus().mul(coverage))) as unknown as Vec4;
};

/**
 * The bloom input of R9: the pixel times the part of its luminance that is above the threshold. The three.js high pass
 * gives the full pixel above the threshold, so a surface at the clip level (a toon face) is added to itself one more time.
 */
export const bloomInput = Fn(({ input, threshold }: { input: Vec4; threshold: Float }) => {
    const level = luminance(input.rgb as never) as unknown as Float;
    return input.mul(max(level.sub(threshold), 0).div(max(level, ALPHA_EPSILON)));
});

export interface GradingUniforms {
    readonly exposure: UniformNode<"float">;
    readonly brightness: UniformNode<"float">;
    readonly contrast: UniformNode<"float">;
    readonly vibrance: UniformNode<"float">;
    readonly tint: UniformNode<"color">;
    readonly bloomIntensity: UniformNode<"float">;
    readonly bloomThreshold: UniformNode<"float">;
    readonly bloomRadius: UniformNode<"float">;
}

/** The grade of R10 on a premultiplied color: exposure, the curve, brightness, contrast, vibrance, and tint. */
export const gradeNode = (color: Vec4, mode: CameraToneMapping, u: GradingUniforms): Vec4 => {
    const covered = color.a.greaterThan(ALPHA_EPSILON);
    const straight = color.rgb.div(max(color.a, ALPHA_EPSILON)) as unknown as Vec3;
    const curve = mode === "aces" ? acesFilmicToneMapping as unknown as Curve : mode === "neutral" ? neutralToneMapping as unknown as Curve : null;
    // The curves change their input in place, so each gets its own variable.
    const mapped = (curve ? curve((vec3(straight) as unknown as { toVar(): Vec3 }).toVar(), u.exposure) : straight.mul(u.exposure)) as unknown as Vec3;
    const bright = max(mapped.mul(u.brightness.add(1)), 0) as unknown as Vec3;
    const contrasted = max(bright.div(CONTRAST_PIVOT), CONTRAST_FLOOR).pow(u.contrast.add(1)).mul(CONTRAST_PIVOT) as unknown as Vec3;
    const vivid = (vibrance as unknown as (color: Vec3, amount: Float) => Vec3)(contrasted, u.vibrance);
    // From 0 to 1, so that the color times a partial alpha stays a valid premultiplied pixel.
    const graded = vivid.mul(u.tint).saturate();
    return select(covered, vec4(graded.mul(color.a), color.a), vec4(0)) as unknown as Vec4;
};

export interface Grading {
    readonly uniforms: GradingUniforms;
    /** Sets the uniforms from the camera group; no recompile (R11). */
    update(grading: CameraGrading): void;
    grade(color: Vec4, mode: CameraToneMapping): Vec4;
    /**
     * A bloom node of `color` with the strength, radius, and threshold of the group. The caller disposes it.
     * three.js sizes the bloom targets from the drawing buffer; `size` fixes them for an offscreen target of another size.
     */
    bloom(color: Vec4, size?: { width: number; height: number }): Vec4 & { dispose(): void };
}

export function createGrading(): Grading {
    const uniforms: GradingUniforms = {
        exposure: uniform(1), brightness: uniform(0), contrast: uniform(0), vibrance: uniform(0), tint: uniform(new Color(1, 1, 1)),
        bloomIntensity: uniform(0), bloomThreshold: uniform(0.8), bloomRadius: uniform(0.4),
    };
    return {
        uniforms,
        update(grading) {
            uniforms.exposure.value = Math.pow(2, grading.exposure);
            uniforms.brightness.value = grading.brightness;
            uniforms.contrast.value = grading.contrast;
            uniforms.vibrance.value = grading.vibrance;
            uniforms.tint.value.set(grading.tint);
            uniforms.bloomIntensity.value = grading.bloom.intensity;
            uniforms.bloomThreshold.value = grading.bloom.threshold;
            uniforms.bloomRadius.value = grading.bloom.radius;
        },
        grade: (color, mode) => gradeNode(color, mode, uniforms),
        bloom(color, size) {
            const node = bloomNode(color as never, uniforms.bloomIntensity as never, uniforms.bloomRadius as never, uniforms.bloomThreshold as never);
            (node as unknown as { highPassFn: unknown }).highPassFn = bloomInput;
            if (size) { const setSize = node.setSize.bind(node); node.setSize = () => setSize(size.width, size.height); }
            return node as unknown as Vec4 & { dispose(): void };
        },
    };
}
