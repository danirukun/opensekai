// MToon avatars with shadows to the shade color, a back-light rim, and an environment fill (character lighting R3).
import {Color, LightingNode, type LightingContext, type LightingModelDirectInput, type Node, type NodeBuilder, type UniformArrayNode, type UniformNode, Vector3} from 'three/webgpu';
import {BRDF_Lambert, diffuseColor, float, materialReference, mix, normalView, normalWorld, positionLocal, positionViewDirection, smoothstep, uniform, uniformArray, varying, vec3, vec4, getShIrradianceAt, renderGroup} from 'three/tsl';
import {MToonLightingModel, MToonNodeMaterial} from '@pixiv/three-vrm/nodes';
import {DEFAULT_AVATAR_LIGHTING} from '@opensekai/contracts';
import {CHARACTER_FILL, EXPONENT, FEATHER_MIN, FLAT_ROOM, RIM, SIDE} from './character-lighting-math';
import {CHARACTER_AMBIENT} from './scene-lights';
import {SNOW_COLOR, SNOW_SHADE} from './snow-math';
import {snowColorEligible, snowMaskNode, snowPushEligible, snowVertex, type SnowShare} from './snow-surface';

/** One object for each renderer; the renderer sets it on each character material. */
export type CharacterShare = {fill: UniformNode<'color'>; sh: UniformArrayNode<'vec3'>; average: UniformNode<'vec3'>};
type Share = Pick<CharacterShare, 'sh' | 'average'>;
/** The share of a renderer before its room irradiance is known: the flat fill. */
export const createCharacterShare = (): CharacterShare => ({
    fill: uniform(new Color(1, 1, 1)),
    sh: uniformArray(FLAT_ROOM.sh.map(([x, y, z]) => new Vector3(x, y, z)), 'vec3').setGroup(renderGroup) as UniformArrayNode<'vec3'>,
    average: uniform(new Vector3(...FLAT_ROOM.average)),
});
/** A uniform write, not a recompile. */
export const setRoomFill = (share: CharacterShare, room: {sh: readonly (readonly number[])[]; average: readonly number[]}) => {
    room.sh.forEach((c, i) => (share.sh.array[i] as Vector3).set(c[0]!, c[1]!, c[2]!));
    share.average.value.set(room.average[0]!, room.average[1]!, room.average[2]!);
};
type Vec3 = Node<'vec3'>;
type Float = Node<'float'>;
type Sum = {addAssign(node: Vec3): unknown};
type Reflected = Record<'directDiffuse' | 'directSpecular' | 'indirectDiffuse' | 'indirectSpecular', Sum>;
type Context = {reflectedLight: Reflected; irradiance: Vec3; iblIrradiance: Vec3 & Sum};
type LightNode = {baseColorNode: Vec3 | null; shadowNode: Float | null};
type Direct = {lightDirection: Vec3; lightColor: Vec3; lightNode: LightNode; reflectedLight: Reflected};
type Variants = {shade: Vec3; shift: Float; toony: Float; rimMix: Float; rimMultiply: Vec3; matcap: Vec3; parametricRim: Vec3};
type Values = {rimStrength: Float; rimWidth: Float; rimTint: Vec3; shadowStrength: Float; environmentFill: Float};
type Build = {variants: Variants; values: Values; shadowed: ReadonlySet<object>; extras: boolean; fill: UniformNode<'color'> | null; ambient: number};
// The private node setups of the three-vrm 3.5.5 material. Its own variants are module values that it does not export.
type MToonSetups = Record<'_setupShadeColorNode' | '_setupShadingShiftNode' | '_setupShadingToonyNode' | '_setupRimLightingMixNode' | '_setupRimMultiplyNode' | '_setupMatcapNode' | '_setupParametricRimNode', () => Node<'vec3'> & Node<'float'>>;
type Parameters = ConstructorParameters<typeof MToonNodeMaterial>[0] & {giEqualizationFactor?: number};

const reference = (name: 'rimStrength' | 'rimWidth' | 'shadowStrength' | 'environmentFill' | 'giEqualizationFactor') => materialReference(name, 'float') as unknown as Float;
const diffuse = diffuseColor as unknown as Vec3;
const lambert = (color: Vec3) => BRDF_Lambert({diffuseColor: color}) as unknown as Vec3;

export class CharacterLightingModel extends MToonLightingModel {
    private readonly build: Build;
    constructor(build: Build) { super(); this.build = build; }
    direct(input: LightingModelDirectInput) {
        const {lightDirection, lightColor, lightNode, reflectedLight} = input as unknown as Direct;
        const {shade, shift, toony, rimMix, rimMultiply, matcap, parametricRim} = this.build.variants;
        const {rimStrength, rimWidth, rimTint, shadowStrength} = this.build.values;
        const dotNL = normalView.dot(lightDirection).clamp(-1, 1);
        const feather = float(1).sub(toony).max(FEATHER_MIN);
        const shadow = this.build.shadowed.has(lightNode) && lightNode.shadowNode ? lightNode.shadowNode : float(1);
        // toonShading of character-lighting-math.ts.
        const shading = dotNL.add(shift).add(feather).div(feather.mul(2)).clamp().mul(mix(float(1), shadow, shadowStrength));
        reflectedLight.directDiffuse.addAssign(lightColor.mul(lambert(mix(shade, diffuse, shading))));
        reflectedLight.directSpecular.addAssign(parametricRim.add(matcap).mul(rimMultiply).mul(mix(vec3(0), lambert(lightColor), rimMix)));
        if (!this.build.extras) return;
        // rimFactor of character-lighting-math.ts. The rim is not shadowed: a back light is behind the shadow casters.
        const edge = float(1).sub(normalView.dot(positionViewDirection)).clamp().pow(mix(float(EXPONENT.narrow), float(EXPONENT.wide), rimWidth));
        const back = smoothstep(RIM.backStart, RIM.backEnd, lightDirection.dot(positionViewDirection).negate());
        const lit = smoothstep(SIDE.start, SIDE.end, dotNL);
        reflectedLight.directSpecular.addAssign(lightColor.mul(rimTint).mul(edge.mul(back).mul(lit).mul(rimStrength)));
    }
    indirectDiffuse(lighting: LightingContext) {
        const context = lighting as unknown as Context, fill = this.build.fill;
        // An avatar surface (it has the share, an outline too) keeps CHARACTER_AMBIENT of the scene ambient: with the fill, the total at
        // the defaults is the scene ambient. A prop or environment MToon material has no share and no fill, so it keeps all of it.
        context.reflectedLight.indirectDiffuse.addAssign(context.irradiance.mul(this.build.ambient).mul(lambert(diffuse)));
        if (!fill) return;
        // `iblIrradiance` holds only the normalized room irradiance of `CharacterEnvironmentNode`. The term has the units of an
        // ambient light (irradiance × Lambert, no π), at CHARACTER_FILL of its intensity.
        context.reflectedLight.indirectDiffuse.addAssign(context.iblIrradiance.mul(fill).mul(this.build.values.environmentFill).mul(CHARACTER_FILL).mul(lambert(diffuse)));
    }
    indirectSpecular(lighting: LightingContext) {
        const {rimMix, rimMultiply, matcap, parametricRim} = this.build.variants;
        (lighting as unknown as Context).reflectedLight.indirectSpecular.addAssign(parametricRim.add(matcap).mul(rimMultiply).mul(mix(vec3(1), vec3(0), rimMix)));
    }
}

// The room irradiance of the nine SH uniforms, mixed toward the mean at world up and world down (MToon GI equalization). The
// coefficients and the mean are normalized on the CPU (`normalizeRoom` of character-lighting-math.ts), so the shader has no
// texture sample and no division.
export class CharacterEnvironmentNode extends LightingNode {
    private readonly share: Share;
    constructor(share: Share) { super(); this.share = share; }
    setup(builder: NodeBuilder): undefined {
        const irradiance = getShIrradianceAt(normalWorld, this.share.sh) as unknown as Vec3;
        (builder.context as unknown as Context).iblIrradiance.addAssign(mix(irradiance, this.share.average as unknown as Vec3, reference('giEqualizationFactor')));
    }
}

export class CharacterMToonMaterial extends MToonNodeMaterial {
    static get type() { return 'CharacterMToonMaterial'; }
    get isCharacterMToonMaterial(): true { return true; }
    // r187 getMaterialCacheKey reduces an own number to 0 or 1: a value that moves to or from 0 makes a new node build at the next
    // light-set rebuild (the same WGSL, so a program cache hit). Other changes are uniform writes.
    rimStrength = DEFAULT_AVATAR_LIGHTING.rimStrength;
    rimWidth = DEFAULT_AVATAR_LIGHTING.rimWidth;
    rimTint = new Color(DEFAULT_AVATAR_LIGHTING.rimTint);
    shadowStrength = DEFAULT_AVATAR_LIGHTING.shadowStrength;
    environmentFill = DEFAULT_AVATAR_LIGHTING.environmentFill;
    giEqualizationFactor: number;
    declare characterShare?: CharacterShare;
    /** The renderer sets it with `needsUpdate = true`. */
    snow: SnowShare | null = null;
    #variants: Variants | null = null;
    #shadowed = new Set<object>();
    // The snow nodes of the current build: one amount varying for the push, the colour, and the variants.
    #snowAmount: Float | null = null;
    #snowMask: Float | null = null;
    constructor(parameters: Parameters = {}) {
        // The parent constructor deletes `giEqualizationFactor` from the parameters.
        const giEqualizationFactor = parameters.giEqualizationFactor ?? 0.9;
        super(parameters);
        this.giEqualizationFactor = giEqualizationFactor;
    }
    customProgramCacheKey() {
        // three.js keeps one node build for each key, and a build holds the storage buffer of its first material. The key
        // has the state of the share, so each avatar reads its own state. The WGSL is the same, so the program is a cache hit.
        const share = this.#snow();
        return super.customProgramCacheKey() + (share ? ':snow' + share.state.id : '');
    }
    setupPosition(builder: NodeBuilder) {
        const share = this.#snow(), vertex = share ? snowVertex(share) : null, amount = vertex ? varying(vertex.amount, 'SnowAmount') as unknown as Float : null;
        this.#snowAmount = amount;
        this.#snowMask = null;
        // Before the morph targets and the skinning: the skin carries the snow with the body. The copies at one position move together.
        if (vertex) positionLocal.addAssign(vertex.push);
        return super.setupPosition(builder);
    }
    setupDiffuseColor(builder: NodeBuilder) {
        super.setupDiffuseColor(builder);
        // An outline copy keeps its colour: it has the push only.
        const share = snowColorEligible(this) ? this.#snow() : null;
        if (!share || !this.#snowAmount) return;
        const mask = this.#snowMask = snowMaskNode(this.#snowAmount, share).toVar('SnowMask') as unknown as Float;
        const color = diffuseColor as unknown as Node<'vec4'>;
        color.assign(vec4(mix(color.rgb, vec3(...SNOW_COLOR), mask), color.a));
    }
    setupVariants() {
        const setups = this as unknown as MToonSetups, mask = this.#snowMask;
        const snowy = (node: Vec3, snow: (node: Vec3, mask: Float) => Vec3) => mask ? snow(node, mask) : node;
        const clear = (node: Vec3, mask: Float) => node.mul(mask.oneMinus());
        this.#variants = {
            shade: snowy(vec3(setups._setupShadeColorNode()), (node, mask) => mix(node, vec3(...SNOW_SHADE), mask)).toVar('ShadeColor'),
            shift: float(setups._setupShadingShiftNode()).toVar('ShadingShift'),
            toony: float(setups._setupShadingToonyNode()).toVar('ShadingToony'),
            rimMix: float(setups._setupRimLightingMixNode()).toVar('RimLightingMix'),
            rimMultiply: vec3(setups._setupRimMultiplyNode()).toVar('RimMultiply'),
            matcap: snowy(vec3(setups._setupMatcapNode()), clear).toVar('matcap'),
            parametricRim: snowy(vec3(setups._setupParametricRimNode()), clear).toVar('ParametricRim'),
        };
    }
    setupLighting(builder: NodeBuilder): Node {
        const shadowed = this.#shadowed = new Set();
        // r187 `AnalyticLightNode.setupShadow` multiplies the shadow into the light color unless the context has `getShadow`. The
        // light nodes build after this method returns, so the hook goes into a context around the lighting, not into builder.context.
        const getShadow = (light: LightNode) => { shadowed.add(light); return light.baseColorNode; };
        return (super.setupLighting(builder) as Vec3).context({getShadow});
    }
    setupLightingModel() {
        // One uniform of each value for all lights of this build.
        const values: Values = {rimStrength: reference('rimStrength'), rimWidth: reference('rimWidth'), rimTint: materialReference('rimTint', 'color') as unknown as Vec3, shadowStrength: reference('shadowStrength'), environmentFill: reference('environmentFill')};
        return new CharacterLightingModel({variants: this.#variants!, values, shadowed: this.#shadowed, extras: !this.isOutline, fill: this.#share()?.fill ?? null, ambient: this.characterShare ? CHARACTER_AMBIENT : 1});
    }
    setupEnvironment() {
        const share = this.#share();
        return share ? new CharacterEnvironmentNode(share) : null;
    }
    // An outline gets neither the added rim nor the environment fill.
    #share() { return this.isOutline ? null : this.characterShare ?? null; }
    #snow() { return this.snow && snowPushEligible(this) ? this.snow : null; }
    copy(source: MToonNodeMaterial) {
        const from = source as CharacterMToonMaterial;
        if (from.isCharacterMToonMaterial) {
            this.rimStrength = from.rimStrength;
            this.rimWidth = from.rimWidth;
            this.rimTint.copy(from.rimTint);
            this.shadowStrength = from.shadowStrength;
            this.environmentFill = from.environmentFill;
            this.giEqualizationFactor = from.giEqualizationFactor;
            this.characterShare = from.characterShare;
            this.snow = from.snow;
        }
        return super.copy(source);
    }
}
