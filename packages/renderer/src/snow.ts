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
    /**
     * `casters` are the roots of the avatars, the props, and the environment. True when a material got or lost its share
     * in this call: the next draw builds it again. `cover` is the session cover of the entity.
     */
    update(entity: SnowEntity, elapsedSeconds: number, cover: number, avatars: readonly SnowAvatar[], casters: readonly Object3D[]): boolean;
    /** The sky pass, then one build-up step for each avatar. Inside the applied frame. */
    render(renderer: WebGPURenderer, scene: Scene): Promise<void>;
    /** The ids of the materials whose pipelines are snow pipelines: the flakes, the sky pass, and each material with a share. */
    materialIds(): ReadonlySet<number>;
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
    const uniforms: SnowUniforms = { rate: uniform(0), buildUpSeconds: uniform(1), meltSeconds: uniform(1), thickness: uniform(0), cover: uniform(0) };
    const noise = compute ? createSnowNoise() : null;
    const settled = new Map<string, Settled>();
    let visible = false, settling = false, rate = 0, clearPending = false;
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
        // No material reads the amounts (a lilToon avatar, or only blended materials): no buffers and no step for each tick.
        if (owned.length === 0) { buildUp?.dispose(); return { root, buildUp: null, share: null, materials: owned, shared, clock, previous: null }; }
        return { root, buildUp, share, materials: owned, shared, clock, previous: null };
    };
    const release = ({ buildUp, share, materials }: Settled) => {
        // The materials let go of the state buffer first: three.js makes a disposed buffer again while a material reads it.
        for (const material of materials) if (material.snow === share) { material.snow = null; material.needsUpdate = true; }
        buildUp?.dispose();
    };
    return {
        flakes: flakes.object,
        update(entity, elapsedSeconds, cover, avatars, casters) {
            const { snow } = entity;
            uniforms.cover.value = cover;
            uniforms.rate.value = snow.rate;
            uniforms.buildUpSeconds.value = snow.buildUpSeconds;
            uniforms.meltSeconds.value = snow.meltSeconds;
            uniforms.thickness.value = snow.thickness;
            sky.update(entity);
            sky.markCasters(casters);
            flakes.update(entity, elapsedSeconds);
            if (visible && settling && !(entity.visible && snow.settleOnCharacters)) clearPending = true;
            visible = entity.visible;
            settling = snow.settleOnCharacters;
            rate = snow.rate;
            // An avatar gets its share when snow settles on characters the first time. It keeps the share while the setting is
            // off: a release and a new share would each build the pipelines of its materials again, which stalls the output.
            const wanted = new Map((compute ? avatars : []).filter(avatar => settling || settled.has(avatar.id)).map(avatar => [avatar.id, avatar]));
            let changed = false;
            for (const [id, entry] of settled) {
                if (wanted.get(id)?.root === entry.root) continue;
                if (entry.materials.length > 0) changed = true;
                release(entry);
                settled.delete(id);
            }
            for (const avatar of wanted.values()) {
                const entry = settled.get(avatar.id);
                if (entry) { entry.clock = avatar.clock; continue; }
                const made = settle(avatar);
                if (made.materials.length > 0) changed = true;
                settled.set(avatar.id, made);
            }
            return changed;
        },
        async render(renderer, scene) {
            // At rate 0 no flake draws and nothing grows, so only a warm step with cover reads the height. The sky pass also
            // updates the world matrices that the build-up steps read, so without it the scene updates them.
            const warming = settling && uniforms.cover.value > 0 && [...settled.values()].some(entry => entry.buildUp?.warming());
            if (visible && (rate > 0 || warming)) await sky.render(renderer, scene);
            else if (visible && settling) scene.updateMatrixWorld();
            if (visible && settling) {
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
        materialIds: () => new Set([flakes.object.material.id, sky.materialId, ...[...settled.values()].flatMap(entry => entry.materials.map(material => material.id))]),
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
