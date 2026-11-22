import type { Node, TextureNode, UniformNode } from "three/webgpu";
import { convertToTexture, max, min, rtt, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { bloom as bloomNode } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { lensflare } from "three/addons/tsl/display/LensflareNode.js";
import { DEFAULT_CAMERA_EFFECTS, DEFAULT_CAMERA_LENS, QUALITY_PROFILES, bokehScale, dofFocalRangeWorld, type CameraEffects, type CameraLens, type QualityProfileId } from "@opensekai/contracts";
import { bloomComposite, bloomInput } from "./grading";

// The look stack of the output camera (#343 R27-R33): depth of field, lens flare, anamorphic smear, and film grain.
type Vec4 = Node<"vec4">;
type Vec3 = Node<"vec3">;
type Vec2 = Node<"vec2">;
type Float = Node<"float">;
type Size = { width: number; height: number };
export type LookQuality = "full" | "cheap";
export type Uv = readonly [number, number];

export const LOOK_ORDER = ["depthOfField", "lensFlare", "anamorphicFlare", "filmGrain"] as const;
export type LookName = (typeof LOOK_ORDER)[number];
export type ActiveLook = Readonly<Record<LookName, boolean>>;

export const FLARE_DOWNSAMPLE_FULL = 4;
export const FLARE_DOWNSAMPLE_CHEAP = 8;
/** The `sigma` argument of the blur that softens the full-quality flare ghosts. */
export const FLARE_BLUR_SIGMA = 4;
export const ANAMORPHIC_TAPS_FULL = 31;
export const ANAMORPHIC_TAPS_CHEAP = 11;
/** The smear length on each side, as a part of the frame, at Spread 1. */
export const ANAMORPHIC_REACH = 0.5;
/** The Gaussian falloff of the tap weights along the smear. */
export const ANAMORPHIC_FALLOFF = 3;
export const ANAMORPHIC_THRESHOLD = 0.1;
export const ANAMORPHIC_GAIN = 4;
export const ANAMORPHIC_TINT = [0.55, 0.75, 1] as const;
/** The bloom that feeds flare and smear when the grading has no bloom. It is not added to the frame. */
export const LOOK_BLOOM = { strength: 1, radius: 0.4, threshold: 0.8 } as const;

export const lookQuality = (profile: QualityProfileId): LookQuality => QUALITY_PROFILES[profile].effectsQuality;
export const effectQuality = (highQuality: boolean, quality: LookQuality): LookQuality => (highQuality && quality === "full" ? "full" : "cheap");

export const activeLook = (effects: CameraEffects | null | undefined): ActiveLook => ({
    depthOfField: !!effects?.depthOfField?.enabled,
    lensFlare: !!effects?.lensFlare?.enabled,
    anamorphicFlare: !!effects?.anamorphicFlare?.enabled,
    filmGrain: !!effects?.filmGrain?.enabled,
});
export const needsLook = (effects: CameraEffects | null | undefined): boolean => Object.values(activeLook(effects)).some(Boolean);

const lookPart = (name: LookName, e: Required<CameraEffects>): string => {
    const low = (highQuality: boolean) => (highQuality ? "" : ":lo");
    switch (name) {
        case "depthOfField": return `dof${low(e.depthOfField.highQuality)}`;
        case "lensFlare": return `flare${low(e.lensFlare.highQuality)}`;
        case "anamorphicFlare": return `smear${low(e.anamorphicFlare.highQuality)}${e.anamorphicFlare.vertical ? ":v" : ""}`;
        case "filmGrain": return "grain";
    }
};
/** R27: the part of the look that needs a new chain. Numbers are uniforms, so they are not in the key. */
export const lookChainKey = (effects: CameraEffects | null | undefined, quality: LookQuality): string => {
    const active = activeLook(effects);
    const e = { ...DEFAULT_CAMERA_EFFECTS, ...effects };
    const parts = LOOK_ORDER.filter(name => active[name]).map(name => lookPart(name, e));
    return parts.length === 0 ? "" : `${parts.join("+")}@${quality}`;
};

/** R29: the inputs of `DepthOfFieldNode`. `focalRange` is a world-unit distance, never the focal length in mm. */
export const dofInputs = (lens: CameraLens, quality: LookQuality) => ({
    focusDistance: lens.focusDistance,
    focalRange: dofFocalRangeWorld(lens.focusDistance, lens.fStop, quality),
    bokehScale: bokehScale(lens.focalLengthMm, lens.fStop, quality),
});

/** V5: the smear taps from -1 to 1 along the smear axis, with Gaussian weights that sum to 1. */
export const anamorphicTaps = (count: number): { t: number; weight: number }[] => {
    const ts = Array.from({ length: count }, (_, i) => (count === 1 ? 0 : -1 + (2 * i) / (count - 1)));
    const raw = ts.map(t => Math.exp(-ANAMORPHIC_FALLOFF * t * t));
    const total = raw.reduce((sum, w) => sum + w, 0);
    return ts.map((t, i) => ({ t, weight: raw[i]! / total }));
};
export const anamorphicUv = (uv: Uv, t: number, reach: number, vertical: boolean): Uv =>
    vertical ? [uv[0], uv[1] + t * reach] : [uv[0] + t * reach, uv[1]];

export interface LookStep { color: Vec4; dispose(): void }
export interface BloomSource { getTextureNode(): TextureNode }

export interface LensLook {
    /** Sets the uniforms from the camera's effects and lens; no recompile (R31). */
    update(effects: CameraEffects | null | undefined, lens: CameraLens | null | undefined, quality: LookQuality): void;
    /** R29, R32: depth of field of a premultiplied colour. `size` fixes the intermediate targets (screenshot). */
    applyDoF(color: Vec4, viewZ: Float, size?: Size): LookStep;
    /** A bloom of `color` for flare and smear when the grading has none. The caller disposes it. */
    bloom(color: Vec4, size?: Size): BloomSource & { dispose(): void };
    /** R28, R32: the flare ghosts and the anamorphic smear of `bloom`, added to `color` with the bloom composite. */
    applyFlareAndSmear(color: Vec4, bloom: BloomSource, effects: CameraEffects, quality: LookQuality, size?: Size): LookStep;
    /** R28: film grain. `displayReferred` keeps the straight colour at most 1 after a grade, so the pixel stays a valid premultiplied pixel. */
    applyFilm(color: Vec4, displayReferred: boolean): Vec4;
    dispose(): void;
}

type Owned = { dispose(): void };
const toTexture = (color: Vec4, size?: Size) =>
    (size ? rtt(color as never, size.width, size.height) : convertToTexture(color as never)) as unknown as TextureNode & { isRTTNode?: boolean; dispose(): void };
const ownedTexture = (node: { isRTTNode?: boolean; dispose(): void }): Owned[] => (node.isRTTNode ? [node] : []);
// three.js sizes these targets from the drawing buffer; an offscreen target of another size needs a fixed size.
const fixSize = (node: { setSize(width: number, height: number): void }, size?: Size) => {
    if (!size) return;
    const setSize = node.setSize.bind(node);
    node.setSize = () => setSize(size.width, size.height);
};

export function createLensLook(): LensLook {
    const u = {
        focus: uniform(DEFAULT_CAMERA_LENS.focusDistance), range: uniform(1), bokeh: uniform(1),
        flareThreshold: uniform(0.5), flareIntensity: uniform(1),
        smearIntensity: uniform(0.5), smearSpread: uniform(0.5),
        grain: uniform(0.15),
    } as const;
    const f = (n: UniformNode<"float">) => n as unknown as Float;
    return {
        update(effects, lens, quality) {
            const e = { ...DEFAULT_CAMERA_EFFECTS, ...effects };
            const inputs = dofInputs(lens ?? DEFAULT_CAMERA_LENS, effectQuality(e.depthOfField.highQuality, quality));
            u.focus.value = inputs.focusDistance;
            u.range.value = inputs.focalRange;
            u.bokeh.value = inputs.bokehScale;
            u.flareThreshold.value = e.lensFlare.threshold;
            u.flareIntensity.value = e.lensFlare.intensity;
            u.smearIntensity.value = e.anamorphicFlare.intensity;
            u.smearSpread.value = e.anamorphicFlare.spread;
            u.grain.value = e.filmGrain.intensity;
        },
        applyDoF(color, viewZ, size) {
            const beauty = toTexture(color, size);
            // three's DoF composite writes alpha 1, so the coverage gets its own DoF with the same CoC; the pair stays premultiplied.
            const coverage = toTexture(vec4(vec3(color.a), 1) as unknown as Vec4, size);
            // The node's `focalLength` slot is a world-unit focus range (dofFocalRangeWorld), not the lens focal length in mm (R29).
            const rgb = dof(beauty as never, viewZ as never, u.focus as never, u.range as never, u.bokeh as never);
            const alpha = dof(coverage as never, viewZ as never, u.focus as never, u.range as never, u.bokeh as never);
            const out = vec4((rgb as unknown as Vec4).rgb, (alpha as unknown as Vec4).r) as unknown as Vec4;
            const owned: Owned[] = [rgb, alpha, ...ownedTexture(beauty), ...ownedTexture(coverage)];
            return { color: out, dispose() { for (const node of owned) node.dispose(); } };
        },
        bloom(color, size) {
            const node = bloomNode(color as never, LOOK_BLOOM.strength, LOOK_BLOOM.radius, LOOK_BLOOM.threshold);
            (node as unknown as { highPassFn: unknown }).highPassFn = bloomInput;
            fixSize(node, size);
            return node as unknown as BloomSource & { dispose(): void };
        },
        applyFlareAndSmear(color, bloom, effects, quality, size) {
            const e = { ...DEFAULT_CAMERA_EFFECTS, ...effects };
            const active = activeLook(effects);
            const source = bloom.getTextureNode() as unknown as TextureNode & { sample(uv: Vec2): Vec4 };
            const owned: Owned[] = [];
            let out = color;
            if (active.lensFlare) {
                const full = effectQuality(e.lensFlare.highQuality, quality) === "full";
                const flare = lensflare(source as never, { threshold: u.flareThreshold as never, downSampleRatio: full ? FLARE_DOWNSAMPLE_FULL : FLARE_DOWNSAMPLE_CHEAP });
                fixSize(flare, size);
                owned.push(flare);
                const ghosts = flare.getTextureNode() as unknown as Vec4;
                const blurred = full ? gaussianBlur(ghosts as never, uniform(1) as never, FLARE_BLUR_SIGMA) : null;
                if (blurred) owned.push(blurred);
                const light = ((blurred ?? ghosts) as unknown as Vec4).rgb.mul(f(u.flareIntensity));
                out = bloomComposite(out, vec4(light, 0) as unknown as Vec4);
            }
            if (active.anamorphicFlare) {
                const taps = anamorphicTaps(effectQuality(e.anamorphicFlare.highQuality, quality) === "full" ? ANAMORPHIC_TAPS_FULL : ANAMORPHIC_TAPS_CHEAP);
                const reach = f(u.smearSpread).mul(ANAMORPHIC_REACH);
                const p = uv() as unknown as Vec2;
                const along = (offset: Float) => (e.anamorphicFlare.vertical ? vec2(0, offset) : vec2(offset, 0)) as unknown as Vec2;
                const sum = taps.reduce<Vec3>((acc, tap) => acc.add(source.sample(p.add(along(reach.mul(tap.t)))).rgb.mul(tap.weight)) as unknown as Vec3, vec3(0) as unknown as Vec3);
                const light = max(sum.sub(ANAMORPHIC_THRESHOLD), 0).mul(vec3(...ANAMORPHIC_TINT)).mul(f(u.smearIntensity)).mul(ANAMORPHIC_GAIN);
                out = bloomComposite(out, vec4(light, 0) as unknown as Vec4);
            }
            return { color: out, dispose() { for (const node of owned) node.dispose(); } };
        },
        applyFilm(color, displayReferred) {
            const grained = film(color as never, u.grain as never) as unknown as Vec4;
            return displayReferred ? vec4(min(grained.rgb, vec3(grained.a)), grained.a) as unknown as Vec4 : grained;
        },
        dispose() { /* The uniforms own no GPU resource; each chain disposes its own steps. */ },
    };
}
