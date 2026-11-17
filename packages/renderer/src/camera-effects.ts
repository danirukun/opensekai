import { Color, Vector2, type Node, type UniformNode } from "three/webgpu";
import { abs, convertToTexture, dot, float, floor, length, max, min, mix, rtt, select, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { DEFAULT_CAMERA_EFFECTS, type CameraEffects, type Id } from "@opensekai/contracts";
import {
    BLINK_EDGE, BLUR_RESOLUTION, BLUR_SIGMA, DIRT_KNEE, DIRT_RESOLUTION, DIRT_SIGMA, LUMA, VIGNETTE_INNER, blockSize, blurStep, type ActiveEffects,
} from "./camera-effects-math";
import type { ScreenImage, ScreenImageLease } from "./screen";

// The camera effect nodes (CAM-15, B37 R10–R14, R17). `camera-effects-math.ts` is the CPU reference of the same math.
type Vec4 = Node<"vec4">;
type Vec3 = Node<"vec3">;
type Vec2 = Node<"vec2">;
type Float = Node<"float">;
type Size = { width: number; height: number };
/** One or more effect steps and the nodes that own GPU targets. The chain disposes them. */
export interface EffectStep { color: Vec4; dispose(): void }

export interface CameraEffectsRuntime {
    /** Sets the uniforms from the camera group, the drawing-buffer size, and the dirt image; no recompile (R17). */
    update(effects: CameraEffects | null | undefined, size: Size, dirt: ScreenImage | null): void;
    /** R10: the dirt light of `color` through the dirt image. `size` fixes the intermediate targets (screenshot). */
    lensDirt(color: Vec4, dirt: ScreenImage, size?: Size): EffectStep;
    /** Blur, night vision, pixelate, and vignetting, in that order, for each active flag (R11–R14, D7). */
    stylize(color: Vec4, active: ActiveEffects, size?: Size): EffectStep;
    dispose(): void;
}

const luma = vec3(...LUMA);
const toTexture = (color: Vec4, size?: Size, scale = 1) =>
    (size ? rtt(color as never, Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale))) : convertToTexture(color as never)) as unknown as
        Vec4 & { sample(uv: Vec2): Vec4; dispose?(): void; isRTTNode?: boolean };

export function createCameraEffects(): CameraEffectsRuntime {
    const u = {
        dirtIntensity: uniform(0), dirtThreshold: uniform(0.5), frameAspect: uniform(16 / 9), dirtAspect: uniform(1),
        blurStep: uniform(0),
        nightTint: uniform(new Color(1, 1, 1)), nightAlpha: uniform(0),
        frameSize: uniform(new Vector2(1920, 1080)), block: uniform(1),
        vignetteTint: uniform(new Color(0, 0, 0)), vignetteAlpha: uniform(0), fadeOut: uniform(0), blink: uniform(0),
    } as const;
    const f = (n: UniformNode<"float">) => n as unknown as Float;
    return {
        update(effects, size, dirt) {
            const e = { ...DEFAULT_CAMERA_EFFECTS, ...effects };
            u.dirtIntensity.value = e.lensDirt.intensity;
            u.dirtThreshold.value = e.lensDirt.threshold;
            u.frameAspect.value = size.width / size.height;
            u.dirtAspect.value = dirt ? dirt.width / dirt.height : 1;
            u.blurStep.value = blurStep(e.blur.intensity, size.height);
            u.nightTint.value.set(e.nightVision.color);
            u.nightAlpha.value = e.nightVision.alpha;
            u.frameSize.value.set(size.width, size.height);
            u.block.value = blockSize(e.pixelate.intensity, size.height);
            u.vignetteTint.value.set(e.vignetting.color);
            u.vignetteAlpha.value = e.vignetting.alpha;
            u.fadeOut.value = e.vignetting.fadeOut;
            u.blink.value = e.vignetting.blink;
        },
        lensDirt(color, dirt, size) {
            const lum = dot(color.rgb, luma) as unknown as Float;
            const weight = smoothstep(f(u.dirtThreshold), f(u.dirtThreshold).add(DIRT_KNEE), lum);
            const bright = vec4(color.rgb.mul(weight), 0) as unknown as Vec4;
            const source = size ? toTexture(bright, size) : bright;
            const glow = gaussianBlur(source as never, uniform(1) as never, DIRT_SIGMA, { resolutionScale: DIRT_RESOLUTION });
            const k = f(u.frameAspect).div(f(u.dirtAspect));
            const dirtUv = uv().sub(0.5).mul(vec2(min(k, 1), min(k.reciprocal(), 1))).add(0.5) as unknown as Vec2;
            const image = texture(dirt.texture, dirtUv) as unknown as Vec4;
            const add = image.rgb.mul(image.a).mul((glow as unknown as Vec4).rgb).mul(f(u.dirtIntensity)) as unknown as Vec3;
            const coverage = max(add.r, max(add.g, add.b)).saturate();
            const out = vec4(color.rgb.add(add), color.a.add(color.a.oneMinus().mul(coverage))) as unknown as Vec4;
            const owned = [glow as unknown as { dispose(): void }, ...(size ? [source as unknown as { dispose(): void }] : [])];
            return { color: out, dispose() { for (const node of owned) node.dispose(); } };
        },
        stylize(input, active, size) {
            const owned: { dispose(): void }[] = [];
            let color = input;
            if (active.blur) {
                // The colour is already premultiplied, so the blur does not premultiply again (R11).
                const source = size ? toTexture(color, size) : color;
                const blurred = gaussianBlur(source as never, u.blurStep as never, BLUR_SIGMA, { resolutionScale: BLUR_RESOLUTION });
                owned.push(blurred as unknown as { dispose(): void }, ...(size ? [source as unknown as { dispose(): void }] : []));
                color = blurred as unknown as Vec4;
            }
            if (active.nightVision) {
                const lum = dot(color.rgb, luma) as unknown as Float;
                color = vec4(mix(color.rgb, (u.nightTint as unknown as Vec3).mul(lum), f(u.nightAlpha)), color.a) as unknown as Vec4;
            }
            if (active.pixelate) {
                const source = toTexture(color, size);
                if (source.isRTTNode) owned.push(source as unknown as { dispose(): void });
                const frame = u.frameSize as unknown as Vec2;
                const block = f(u.block);
                const half = vec2(0.5).div(frame);
                const snapped = floor(uv().mul(frame).div(block)).add(0.5).mul(block).div(frame).clamp(half, vec2(1).sub(half)) as unknown as Vec2;
                color = source.sample(snapped);
            }
            if (active.vignetting) {
                const p = uv() as unknown as Vec2;
                const aspect = vec2(f(u.frameAspect), 1);
                const d = length(p.sub(0.5).mul(aspect)).div(length(aspect.mul(0.5)));
                const shape = smoothstep(float(VIGNETTE_INNER).mul(f(u.fadeOut).oneMinus()), 1, d);
                const blink = f(u.blink);
                const edge = abs(p.y.mul(2).sub(1));
                const lid = select(blink.greaterThan(0), smoothstep(blink.oneMinus().sub(BLINK_EDGE), blink.oneMinus(), edge), float(0));
                const s = max(f(u.vignetteAlpha).mul(shape), lid);
                const tint = (u.vignetteTint as unknown as Vec3).mul(color.a);
                color = vec4(color.rgb.mul(s.oneMinus()).add(tint.mul(s)), color.a) as unknown as Vec4;
            }
            return { color, dispose() { for (const node of owned) node.dispose(); } };
        },
        dispose() { /* The uniforms own no GPU resource; each chain disposes its own steps. */ },
    };
}

type DirtState = ScreenImage | null | "failed";
/**
 * The dirt image of the output camera, from the screen image pool with one lease (R20). `texture` gives `null` while the
 * load runs, the image after it, and `"failed"` after a failure, with no retry until the ID changes.
 */
export function createDirtSource(pool: { acquire(id: string): Promise<ScreenImageLease> }) {
    type Entry = { id: Id; state: DirtState; lease?: ScreenImageLease };
    let current: Entry | null = null;
    let disposed = false;
    const drop = () => { current?.lease?.release(); current = null; };
    return {
        texture(assetId: Id | null): DirtState {
            if (disposed || assetId === null) { drop(); return null; }
            if (current?.id === assetId) return current.state;
            drop();
            const entry: Entry = { id: assetId, state: null };
            current = entry;
            pool.acquire(assetId).then(
                lease => { if (current === entry && !disposed) { entry.lease = lease; entry.state = lease.image; } else lease.release(); },
                () => { if (current === entry) entry.state = "failed"; });
            return null;
        },
        /** The loaded image of this ID, without a change of the lease. */
        peek(assetId: Id): ScreenImage | null {
            return current?.id === assetId && current.state !== null && current.state !== "failed" ? current.state : null;
        },
        dispose() { disposed = true; drop(); },
    };
}
