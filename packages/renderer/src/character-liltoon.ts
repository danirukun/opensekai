// lilToon avatars with the character share: Shadow Strength on the cast shadow and the room fill of CharacterMToonMaterial (lilToon on WebGPU R8).
import type {Node, NodeBuilder} from 'three/webgpu';
import {diffuseColor, float, materialReference, mix, normalLocal, positionLocal, varying, vec3, vec4} from 'three/tsl';
import {LilToonNodeMaterial} from '@mochiya/three-liltoon/webgpu';
import {DEFAULT_AVATAR_LIGHTING} from '@opensekai/contracts';
import {CharacterEnvironmentNode, type CharacterShare} from './character-mtoon';
import {CHARACTER_FILL} from './character-lighting-math';
import {CHARACTER_AMBIENT} from './scene-lights';
import {SNOW_COLOR, SNOW_SHADE} from './snow-math';
import {snowAmount, snowColorEligible, snowMaskNode, snowPushEligible, type SnowShare} from './snow-surface';

type Vec3 = Node<'vec3'>;
type Float = Node<'float'>;
// One node of each value for all lights and builds, as the material references of three are: each reads the material it draws.
const shadowStrength = materialReference('shadowStrength', 'float') as unknown as Float;
const environmentFill = materialReference('environmentFill', 'float') as unknown as Float;

// The fork builds its nodes in the constructor, before these fields exist, so the hooks read the fields when a program builds.
export class CharacterLilToonMaterial extends LilToonNodeMaterial {
    static get type() { return 'CharacterLilToonMaterial'; }
    readonly isCharacterLilToonMaterial = true;
    shadowStrength = DEFAULT_AVATAR_LIGHTING.shadowStrength;
    environmentFill = DEFAULT_AVATAR_LIGHTING.environmentFill;
    // The GI equalization of CharacterEnvironmentNode, at the MToon default: the lilToon extension has no such value.
    giEqualizationFactor = 0.9;
    characterShare: CharacterShare | null = null;
    /** The renderer sets it with `needsUpdate = true`. */
    snow: SnowShare | null = null;
    // The snow nodes of the current build: one amount varying for the push and the colour, and the mask of the colour.
    #snowAmount: Float | null = null;
    #snowMask: Float | null = null;
    // Along the rest normal, before the morph targets and the skinning, as CharacterMToonMaterial. The outline offset of the fork
    // takes `positionLocal` as its base, so an outline copy follows the snow.
    override setupPosition(builder: NodeBuilder) {
        const share = this.#snow(), amount = share ? varying(snowAmount(share), 'SnowAmount') as unknown as Float : null;
        this.#snowAmount = amount;
        this.#snowMask = null;
        if (share && amount) positionLocal.addAssign(normalLocal.mul(share.thickness).mul(amount));
        return super.setupPosition(builder);
    }
    // The lighting model reads `diffuseColor` as the albedo, so the snow colour is in the bands and the effects.
    override setupDiffuseColor(builder: NodeBuilder): void {
        super.setupDiffuseColor(builder);
        const share = snowColorEligible(this) ? this.#snow() : null;
        if (!share || !this.#snowAmount) return;
        const mask = this.#snowMask = snowMaskNode(this.#snowAmount, share).toVar('SnowMask') as unknown as Float;
        const color = diffuseColor as unknown as Node<'vec4'>;
        color.assign(vec4(mix(color.rgb, vec3(...SNOW_COLOR), mask), color.a));
    }
    protected override shadeColor(shade: Vec3): Vec3 {
        const mask = this.#snowMask;
        return mask ? mix(shade, vec3(...SNOW_SHADE), mask) : shade;
    }
    // The snow covers the backlight, the matcap, and the rim. Emission does not change, as on MToon.
    protected override effectStrength(): Float | null {
        return this.#snowMask?.oneMinus() ?? null;
    }
    // Only the cast shadow of the shadow map. The authored bands do not change.
    protected override receivedShadow(shadow: Float): Float {
        return mix(float(1), shadow, shadowStrength);
    }
    // The cast shadow after the band step, as CharacterMToonMaterial: a converted MToon avatar keeps the shadow size of its original.
    protected override receivedShadowAfterBands(): boolean {
        return true;
    }
    // `indirectDiffuse` of CharacterLightingModel without the Lambert term, which the lilToon model applies: the scene ambient at
    // CHARACTER_AMBIENT on an avatar surface, an outline too, plus the room fill of `CharacterEnvironmentNode` (`iblIrradiance`).
    protected override roomIrradiance(irradiance: Vec3, iblIrradiance: Vec3): Vec3 {
        const ambient = this.characterShare ? irradiance.mul(CHARACTER_AMBIENT) : irradiance;
        const share = this.#share();
        return share ? ambient.add(iblIrradiance.mul(share.fill).mul(environmentFill).mul(CHARACTER_FILL)) : ambient;
    }
    setupEnvironment() {
        const share = this.#share();
        return share ? new CharacterEnvironmentNode(share) : null;
    }
    // An outline gets no environment fill.
    #share() { return this.isOutline ? null : this.characterShare; }
    #snow() { return this.snow && snowPushEligible(this) ? this.snow : null; }
    // The fork shares one program between materials with the same key, and a build holds the storage buffer of its first
    // material. The key has the state of the share, so each avatar reads its own state, as CharacterMToonMaterial.
    override customProgramCacheKey(): string {
        const share = this.#snow();
        return `${super.customProgramCacheKey()}|${this.characterShare ? 'character' : ''}${share ? ':snow' + share.state.id : ''}`;
    }
    override copy(source: LilToonNodeMaterial): this {
        super.copy(source);
        const from = source as CharacterLilToonMaterial;
        if (from.isCharacterLilToonMaterial) {
            this.shadowStrength = from.shadowStrength;
            this.environmentFill = from.environmentFill;
            this.giEqualizationFactor = from.giEqualizationFactor;
            this.characterShare = from.characterShare;
            this.snow = from.snow;
        }
        return this;
    }
}
