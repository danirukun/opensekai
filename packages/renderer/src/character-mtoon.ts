// MToon avatars with shadows to the shade color, a back-light rim, and an environment fill (character lighting R3).
import {Color, LightingNode, type LightingContext, type LightingModelDirectInput, type Node, type NodeBuilder, type Texture, type UniformNode} from 'three/webgpu';
import {BRDF_Lambert, diffuseColor, float, materialReference, mix, normalView, normalWorld, pmremTexture, positionViewDirection, smoothstep, vec3} from 'three/tsl';
import {MToonLightingModel, MToonNodeMaterial} from '@pixiv/three-vrm/nodes';
import {DEFAULT_AVATAR_LIGHTING} from '@opensekai/contracts';
import {CHARACTER_FILL, EXPONENT, LUMINANCE, RIM} from './character-lighting-math';

/** One object for each renderer; the renderer sets it on each character material. */
export type CharacterShare = {fill: UniformNode<'color'>; map: Texture | null};
type Vec3 = Node<'vec3'>;
type Float = Node<'float'>;
type Sum = {addAssign(node: Vec3): unknown};
type Reflected = Record<'directDiffuse' | 'directSpecular' | 'indirectDiffuse' | 'indirectSpecular', Sum>;
type Context = {reflectedLight: Reflected; iblIrradiance: Vec3 & Sum};
type LightNode = {baseColorNode: Vec3 | null; shadowNode: Float | null};
type Direct = {lightDirection: Vec3; lightColor: Vec3; lightNode: LightNode; reflectedLight: Reflected};
type Variants = {shade: Vec3; shift: Float; toony: Float; rimMix: Float; rimMultiply: Vec3; matcap: Vec3; parametricRim: Vec3};
type Values = {rimStrength: Float; rimWidth: Float; rimTint: Vec3; shadowStrength: Float; environmentFill: Float};
type Build = {variants: Variants; values: Values; shadowed: ReadonlySet<object>; extras: boolean; fill: UniformNode<'color'> | null};
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
        const feather = float(1).sub(toony);
        const shadow = this.build.shadowed.has(lightNode) && lightNode.shadowNode ? lightNode.shadowNode : float(1);
        // toonShading of character-lighting-math.ts.
        const shading = dotNL.add(shift).add(feather).div(feather.mul(2)).clamp().mul(mix(float(1), shadow, shadowStrength));
        reflectedLight.directDiffuse.addAssign(lightColor.mul(lambert(mix(shade, diffuse, shading))));
        reflectedLight.directSpecular.addAssign(parametricRim.add(matcap).mul(rimMultiply).mul(mix(vec3(0), lambert(lightColor), rimMix)));
        if (!this.build.extras) return;
        // rimFactor of character-lighting-math.ts. The rim is not shadowed: a back light is behind the shadow casters.
        const edge = float(1).sub(normalView.dot(positionViewDirection)).clamp().pow(mix(float(EXPONENT.narrow), float(EXPONENT.wide), rimWidth));
        const back = smoothstep(RIM.backStart, RIM.backEnd, lightDirection.dot(positionViewDirection).negate());
        reflectedLight.directSpecular.addAssign(lightColor.mul(rimTint).mul(edge.mul(back).mul(rimStrength)));
    }
    indirectDiffuse(lighting: LightingContext) {
        super.indirectDiffuse(lighting);
        const context = lighting as unknown as Context, fill = this.build.fill;
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

// The diffuse part of the room map only, mixed toward the mean of its irradiance at world up and world down (MToon GI equalization),
// then divided by the luminance of that mean (`normalizeFill` of character-lighting-math.ts). The level cancels, so no π.
class CharacterEnvironmentNode extends LightingNode {
    private readonly map: Texture;
    constructor(map: Texture) { super(); this.map = map; }
    setup(builder: NodeBuilder): undefined {
        const irradiance = (direction: Vec3) => pmremTexture(this.map, direction, float(1)) as unknown as Vec3;
        const average = irradiance(vec3(0, 1, 0)).add(irradiance(vec3(0, -1, 0))).mul(0.5);
        const level = average.dot(vec3(...LUMINANCE)).max(1e-4);
        (builder.context as unknown as Context).iblIrradiance.addAssign(mix(irradiance(normalWorld), average, reference('giEqualizationFactor')).div(level));
    }
}

export class CharacterMToonMaterial extends MToonNodeMaterial {
    static get type() { return 'CharacterMToonMaterial'; }
    get isCharacterMToonMaterial(): true { return true; }
    rimStrength = DEFAULT_AVATAR_LIGHTING.rimStrength;
    rimWidth = DEFAULT_AVATAR_LIGHTING.rimWidth;
    rimTint = new Color(DEFAULT_AVATAR_LIGHTING.rimTint);
    shadowStrength = DEFAULT_AVATAR_LIGHTING.shadowStrength;
    environmentFill = DEFAULT_AVATAR_LIGHTING.environmentFill;
    giEqualizationFactor: number;
    declare characterShare?: CharacterShare;
    #variants: Variants | null = null;
    #shadowed = new Set<object>();
    constructor(parameters: Parameters = {}) {
        // The parent constructor deletes `giEqualizationFactor` from the parameters.
        const giEqualizationFactor = parameters.giEqualizationFactor ?? 0.9;
        super(parameters);
        this.giEqualizationFactor = giEqualizationFactor;
    }
    setupVariants() {
        const setups = this as unknown as MToonSetups;
        this.#variants = {
            shade: vec3(setups._setupShadeColorNode()).toVar('ShadeColor'),
            shift: float(setups._setupShadingShiftNode()).toVar('ShadingShift'),
            toony: float(setups._setupShadingToonyNode()).toVar('ShadingToony'),
            rimMix: float(setups._setupRimLightingMixNode()).toVar('RimLightingMix'),
            rimMultiply: vec3(setups._setupRimMultiplyNode()).toVar('RimMultiply'),
            matcap: vec3(setups._setupMatcapNode()).toVar('matcap'),
            parametricRim: vec3(setups._setupParametricRimNode()).toVar('ParametricRim'),
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
        return new CharacterLightingModel({variants: this.#variants!, values, shadowed: this.#shadowed, extras: !this.isOutline, fill: this.#share()?.fill ?? null});
    }
    setupEnvironment() {
        const share = this.#share();
        return share ? new CharacterEnvironmentNode(share.map) : null;
    }
    // An outline gets neither the added rim nor the environment fill.
    #share() { const share = this.characterShare; return share?.map && !this.isOutline ? {fill: share.fill, map: share.map} : null; }
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
        }
        return super.copy(source);
    }
}
