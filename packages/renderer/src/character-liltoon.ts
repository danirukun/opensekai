// lilToon avatars with the character share: Shadow Strength on the cast shadow and the room fill of CharacterMToonMaterial (lilToon on WebGPU R8).
import type {Node} from 'three/webgpu';
import {float, materialReference, mix} from 'three/tsl';
import {LilToonNodeMaterial} from '@mochiya/three-liltoon/webgpu';
import {DEFAULT_AVATAR_LIGHTING} from '@opensekai/contracts';
import {CharacterEnvironmentNode, type CharacterShare} from './character-mtoon';
import {CHARACTER_FILL} from './character-lighting-math';
import {CHARACTER_AMBIENT} from './scene-lights';

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
    // Only the cast shadow of the shadow map. The authored bands do not change.
    protected override receivedShadow(shadow: Float): Float {
        return mix(float(1), shadow, shadowStrength);
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
    override customProgramCacheKey(): string {
        return `${super.customProgramCacheKey()}|${this.characterShare ? 'character' : ''}`;
    }
    override copy(source: LilToonNodeMaterial): this {
        super.copy(source);
        const from = source as CharacterLilToonMaterial;
        if (from.isCharacterLilToonMaterial) {
            this.shadowStrength = from.shadowStrength;
            this.environmentFill = from.environmentFill;
            this.giEqualizationFactor = from.giEqualizationFactor;
            this.characterShare = from.characterShare;
        }
        return this;
    }
}
