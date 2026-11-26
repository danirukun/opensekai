import type { Material, Object3D, Scene, UniformNode, WebGPURenderer } from "three/webgpu";
import { uniform } from "three/tsl";
import type { AppError } from "@opensekai/contracts";
import type { CharacterMToonMaterial } from "./character-mtoon";
import { createSnowBuildUp, type SnowBuildUp, type SnowUniforms } from "./snow-build-up";
import { createSnowFlakes } from "./snow-flakes";
import { snowSteps } from "./snow-math";
import { createSnowSky, type SnowEntity } from "./snow-sky";
import { createSnowNoise, snowEligible, type SnowShare } from "./snow-surface";
import type { SpringClock } from "./spring-grid";

export interface SnowAvatar { id: string; root: Object3D; materials: readonly Material[]; clock: SpringClock }
export interface Snow {
    readonly flakes: Object3D;
    /** `casters` are the roots of the avatars, the props, and the environment. */
    update(entity: SnowEntity, elapsedSeconds: number, avatars: readonly SnowAvatar[], casters: readonly Object3D[]): void;
    /** The sky pass, then one build-up step for each avatar. Inside the applied frame. */
    render(renderer: WebGPURenderer, scene: Scene): Promise<void>;
    warnings(): AppError[];
    dispose(): void;
}

interface Settled {
    root: Object3D;
    /** Null for a root with no skinned vertex. */
    buildUp: SnowBuildUp | null;
    share: SnowShare | null;
    /** The materials that hold `share`. */
    materials: CharacterMToonMaterial[];
    /** True when a material of the avatar holds the share of another avatar. */
    shared: boolean;
    clock: SpringClock;
    previous: SpringClock | null;
}

const isMToon = (material: Material): material is CharacterMToonMaterial => (material as Partial<CharacterMToonMaterial>).isCharacterMToonMaterial === true;

/** The snow of one renderer: the sky pass, the flakes, and a build-up for each avatar. `compute` is false on WebGL 2. */
export function createSnow({ tint, compute }: { tint: UniformNode<"color">; compute: boolean }): Snow {
    const sky = createSnowSky(), flakes = createSnowFlakes(sky, tint);
    const uniforms: SnowUniforms = { rate: uniform(0), buildUpSeconds: uniform(1), meltSeconds: uniform(1), thickness: uniform(0) };
    const noise = compute ? createSnowNoise() : null;
    const settled = new Map<string, Settled>();
    let visible = false, clearPending = false;
    const settle = ({ root, materials, clock }: SnowAvatar): Settled => {
        const buildUp = createSnowBuildUp(root, sky, uniforms);
        const share = buildUp && noise ? { state: buildUp.state, count: buildUp.count, thickness: uniforms.thickness, noise } : null;
        const owned: CharacterMToonMaterial[] = [];
        let shared = false;
        if (share) for (const material of materials) {
            if (!isMToon(material) || !snowEligible(material)) continue;
            if (material.snow) { shared = true; continue; }
            material.snow = share;
            material.needsUpdate = true;
            owned.push(material);
        }
        return { root, buildUp, share, materials: owned, shared, clock, previous: null };
    };
    const release = ({ buildUp, share, materials }: Settled) => {
        // The materials let go of the state buffer first: three.js makes a disposed buffer again while a material reads it.
        for (const material of materials) if (material.snow === share) { material.snow = null; material.needsUpdate = true; }
        buildUp?.dispose();
    };
    return {
        flakes: flakes.object,
        update(entity, elapsedSeconds, avatars, casters) {
            const { snow } = entity;
            uniforms.rate.value = snow.rate;
            uniforms.buildUpSeconds.value = snow.buildUpSeconds;
            uniforms.meltSeconds.value = snow.meltSeconds;
            uniforms.thickness.value = snow.thickness;
            sky.update(entity);
            sky.markCasters(casters);
            flakes.update(entity, elapsedSeconds);
            if (visible && !entity.visible) clearPending = true;
            visible = entity.visible;
            const wanted = new Map((compute && snow.settleOnCharacters ? avatars : []).map(avatar => [avatar.id, avatar]));
            for (const [id, entry] of settled) {
                if (wanted.get(id)?.root === entry.root) continue;
                release(entry);
                settled.delete(id);
            }
            for (const avatar of wanted.values()) {
                const entry = settled.get(avatar.id);
                if (entry) entry.clock = avatar.clock;
                else settled.set(avatar.id, settle(avatar));
            }
        },
        async render(renderer, scene) {
            if (visible) {
                // The sky pass also updates the world matrices that the build-up steps read.
                await sky.render(renderer, scene);
                for (const entry of settled.values()) {
                    const { seconds, reset } = snowSteps(entry.previous, entry.clock);
                    entry.buildUp?.step(renderer, seconds, reset);
                    entry.previous = entry.clock;
                }
                return;
            }
            if (!clearPending) return;
            clearPending = false;
            // A step of 0 s is a reset: it writes amount 0 and needs no current world matrix. The next visible step resets too.
            for (const entry of settled.values()) {
                entry.buildUp?.clear();
                entry.buildUp?.step(renderer, 0, false);
                entry.previous = null;
            }
        },
        warnings: () => [...settled].filter(([, entry]) => entry.shared).map(([id]) => ({ code: "UNSUPPORTED", message: "Snow build-up shares a material", ids: [id] })),
        dispose() {
            for (const entry of settled.values()) release(entry);
            settled.clear();
            flakes.dispose();
            sky.dispose();
            noise?.dispose();
        },
    };
}
