import { AmbientLight, DirectionalLight, PointLight, PCFShadowMap, type Material, type Object3D, type OrthographicCamera, type Scene, type WebGPURenderer } from "three/webgpu";
import { lights } from "three/tsl";
import type { Id, LightSettings, SceneEntity, Vec3 } from "@opensekai/contracts";
import { rotateByQuaternion } from "@opensekai/contracts";

export type LightGroup = "characters" | "props" | "environment";
export type LightGroups = Record<LightGroup, Id[]>;
type LightEntity = Extract<SceneEntity, { kind: "light" }>;

const isLight = (entity: SceneEntity): entity is LightEntity => entity.kind === "light";
export const groupOf = (entity: SceneEntity): LightGroup | null =>
    entity.kind === "avatar" ? "characters" : entity.kind === "mesh" ? "props" : entity.kind === "environment" ? "environment" : null;

/** The light entities that light each material group, in scene order (R6). */
export function lightGroups(entities: readonly SceneEntity[]): LightGroups {
    const all = entities.filter(isLight);
    return {
        characters: all.filter(e => e.light.affectCharacters).map(e => e.id),
        props: all.filter(e => e.light.affectProps).map(e => e.id),
        environment: all.filter(e => e.light.affectEnvironment).map(e => e.id),
    };
}

/** The values that rebuild the node sets (R7): the light count and order, each type, affect flag, and shadow switch. Visibility, color, intensity, range, and transform are not part of it. */
export function lightSignature(entities: readonly SceneEntity[]): string {
    const all = entities.filter(isLight);
    if (!all.length) return "builtin";
    return JSON.stringify(all.map(({ id, light: l }) => [id, l.type, l.affectCharacters, l.affectProps, l.affectEnvironment, l.shadow.enabled]));
}

export const shadowsOn = (entities: readonly SceneEntity[]): boolean => entities.some(e => isLight(e) && e.light.shadow.enabled);

/** A light shines along its local −Z axis (R4). */
export const lightDirection = (rotation: readonly number[]): Vec3 => rotateByQuaternion([0, 0, -1], rotation);

export const DIRECTIONAL_DISTANCE = 50;
const SHADOW_BOX = 10, SHADOW_NEAR = 0.5, SHADOW_FAR = 100;

type ThreeLight = DirectionalLight | PointLight;
export interface SceneLights {
    /** Reconciles the three.js lights with the frame. Returns true when the node sets were rebuilt, so the caller reassigns materials and compiles again. */
    apply(entities: readonly SceneEntity[]): boolean;
    /** Sets the group node set on each lit material of `root` and the shadow flags of its meshes. */
    assign(root: Object3D, group: LightGroup): void;
    signature(): string;
    /** Increases on each node-set rebuild, so an A → B → A change still reassigns materials that hold the old nodes. */
    generation(): number;
    shadows(): boolean;
    dispose(): void;
}

// A lit material: standard, physical, Phong, Lambert, toon, or MToon. Unlit materials keep scene lights, which they ignore.
export const isLitMaterial = (material: Material): boolean => {
    const m = material as Material & Record<string, unknown>;
    return m.isMeshStandardMaterial === true || m.isMeshPhongMaterial === true || m.isMeshLambertMaterial === true || m.isMeshToonMaterial === true || m.isMToonNodeMaterial === true || m.isMToonMaterial === true;
};

export function createSceneLights(scene: Scene, renderer: WebGPURenderer): SceneLights {
    const ambient = new AmbientLight(0xffffff, 1);
    // The built-in light (R5): it lights all materials when the scene has no light entity.
    const builtin = new DirectionalLight(0xffffff, 3);
    builtin.position.set(2, 4, 3);
    scene.add(ambient, builtin, builtin.target);
    renderer.shadowMap.type = PCFShadowMap;
    const owned = new Map<Id, { type: LightSettings["type"]; light: ThreeLight }>();
    let current = "", generation = 0, nodes: Record<LightGroup, ReturnType<typeof lights>> | null = null, shadows = false;
    const create = (settings: LightSettings): ThreeLight => {
        if (settings.type === "point") {
            const light = new PointLight(0xffffff, 1, 0, 2);
            light.shadow.mapSize.set(1024, 1024);
            scene.add(light);
            return light;
        }
        const light = new DirectionalLight(0xffffff, 1);
        light.shadow.mapSize.set(2048, 2048);
        const camera = light.shadow.camera as OrthographicCamera;
        camera.left = -SHADOW_BOX; camera.right = SHADOW_BOX; camera.top = SHADOW_BOX; camera.bottom = -SHADOW_BOX;
        camera.near = SHADOW_NEAR; camera.far = SHADOW_FAR;
        camera.updateProjectionMatrix();
        scene.add(light, light.target);
        return light;
    };
    const release = (light: ThreeLight) => {
        light.removeFromParent();
        if ((light as DirectionalLight).isDirectionalLight) (light as DirectionalLight).target.removeFromParent();
        light.dispose();
    };
    const update = (light: ThreeLight, entity: LightEntity) => {
        const { light: settings, transform } = entity;
        light.color.set(settings.color);
        // A hidden light stays in its node sets with intensity 0, so a visibility change does not recompile (R7).
        light.intensity = entity.visible ? settings.intensity : 0;
        light.castShadow = settings.shadow.enabled;
        light.shadow.intensity = settings.shadow.intensity;
        light.shadow.bias = settings.shadow.bias;
        light.shadow.normalBias = settings.shadow.normalBias;
        // Soft radius 2: radius 4 gave diagonal streaks at 2048 px in the owner's macOS check.
        light.shadow.radius = settings.shadow.soft ? 2 : 1;
        if ((light as PointLight).isPointLight) {
            const point = light as PointLight;
            point.position.fromArray(transform.position);
            point.distance = settings.range;
        } else {
            const directional = light as DirectionalLight;
            const [x, y, z] = lightDirection(transform.rotation);
            directional.position.set(-x * DIRECTIONAL_DISTANCE, -y * DIRECTIONAL_DISTANCE, -z * DIRECTIONAL_DISTANCE);
            directional.target.position.set(0, 0, 0);
            directional.target.updateMatrixWorld(true);
        }
        light.updateMatrixWorld(true);
    };
    return {
        apply(entities) {
            const wanted = entities.filter(isLight);
            for (const [id, value] of owned) {
                const entity = wanted.find(e => e.id === id);
                if (!entity || entity.light.type !== value.type) { release(value.light); owned.delete(id); }
            }
            for (const entity of wanted) {
                let value = owned.get(entity.id);
                if (!value) { value = { type: entity.light.type, light: create(entity.light) }; owned.set(entity.id, value); }
                update(value.light, entity);
            }
            builtin.intensity = wanted.length ? 0 : 3;
            const signature = lightSignature(entities);
            if (signature === current && nodes) return false;
            current = signature;
            generation += 1;
            const groups = lightGroups(entities);
            const set = (ids: Id[]) => lights([ambient, ...(wanted.length ? ids.map(id => owned.get(id)!.light) : [builtin])]);
            nodes = { characters: set(groups.characters), props: set(groups.props), environment: set(groups.environment) };
            shadows = shadowsOn(entities);
            renderer.shadowMap.enabled = shadows;
            return true;
        },
        assign(root, group) {
            const node = nodes?.[group] ?? null;
            root.traverse(object => {
                const mesh = object as Object3D & { isMesh?: boolean; material?: Material | Material[] };
                if (!mesh.isMesh) return;
                if (mesh.castShadow !== shadows || mesh.receiveShadow !== shadows) { mesh.castShadow = shadows; mesh.receiveShadow = shadows; }
                for (const material of [mesh.material ?? []].flat()) {
                    if (!isLitMaterial(material)) continue;
                    const holder = material as Material & { lightsNode: unknown };
                    if (holder.lightsNode === node) continue;
                    const used = holder.lightsNode !== undefined;
                    holder.lightsNode = node;
                    material.needsUpdate = true;
                    // three.js 0.180 leaves `lightsNode` out of the render-object cache key of a plain (glTF) material, so
                    // `needsUpdate` alone keeps the old pipeline on the canvas. Dispose drops its render objects; textures stay.
                    if (used) material.dispose();
                }
            });
        },
        signature: () => current,
        generation: () => generation,
        shadows: () => shadows,
        dispose() {
            for (const value of owned.values()) release(value.light);
            owned.clear();
            ambient.removeFromParent(); builtin.removeFromParent(); builtin.target.removeFromParent();
            builtin.dispose();
            nodes = null;
        },
    };
}
