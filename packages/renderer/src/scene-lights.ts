import { AmbientLight, DirectionalLight, MathUtils, PointLight, PCFShadowMap, SpotLight, type Material, type Object3D, type OrthographicCamera, type PerspectiveCamera, type Scene, type WebGPURenderer } from "three/webgpu";
import { lights } from "three/tsl";
import type { Id, LightSettings, SceneEntity, Transform, Vec3 } from "@opensekai/contracts";
import { rotateByQuaternion } from "@opensekai/contracts";
import { HAZE_LAYER } from "./haze";

export type LightGroup = "characters" | "props" | "environment" | "haze";
export type LightGroups = Record<LightGroup, Id[]>;
type LightEntity = Extract<SceneEntity, { kind: "light" }>;

const isLight = (entity: SceneEntity): entity is LightEntity => entity.kind === "light";
export const groupOf = (entity: SceneEntity): LightGroup | null =>
    entity.kind === "avatar" ? "characters" : entity.kind === "mesh" ? "props" : entity.kind === "environment" ? "environment" : null;

/** A point or spot light with `volumetric` scatters in haze; three.js r180 ignores lights without a distance (B13 R1, R7). */
export const scattersInHaze = (light: LightSettings): boolean => light.volumetric === true && (light.type === "point" || light.type === "spot");

/** The light entities that light each material group, in scene order (R6), and the lights that scatter in haze (B13 R7). */
export function lightGroups(entities: readonly SceneEntity[]): LightGroups {
    const all = entities.filter(isLight);
    return {
        characters: all.filter(e => e.light.affectCharacters).map(e => e.id),
        props: all.filter(e => e.light.affectProps).map(e => e.id),
        environment: all.filter(e => e.light.affectEnvironment).map(e => e.id),
        haze: all.filter(e => scattersInHaze(e.light)).map(e => e.id),
    };
}

/** An ambient light entity replaces the fixed ambient light in the node sets (B13 R4). */
export const usesFixedAmbient = (entities: readonly SceneEntity[]): boolean => !entities.some(e => isLight(e) && e.light.type === "ambient");

/** The three.js spot angle (half the cone) in radians, from the full cone angle in degrees (B13 R3). */
export const spotAngle = (angleDegrees: number): number => MathUtils.degToRad(angleDegrees / 2);

/** The values that rebuild the node sets (R7): the light count and order, each type, affect flag, and shadow switch. Visibility, color, intensity, range, and transform are not part of it. */
export function lightSignature(entities: readonly SceneEntity[]): string {
    const all = entities.filter(isLight);
    if (!all.length) return "builtin";
    return JSON.stringify(all.map(({ id, light: l }) => [id, l.type, l.affectCharacters, l.affectProps, l.affectEnvironment, l.shadow.enabled, scattersInHaze(l)]));
}

export const shadowsOn = (entities: readonly SceneEntity[]): boolean => entities.some(e => isLight(e) && e.light.shadow.enabled);

/** A light shines along its local −Z axis (R4). */
export const lightDirection = (rotation: readonly number[]): Vec3 => rotateByQuaternion([0, 0, -1], rotation);

/** Each entity with a gizmo draft, drawn at its draft transform (B12 R7). */
export const withDrafts = (entities: readonly SceneEntity[], draft: (id: Id) => Transform | null): SceneEntity[] =>
    entities.map(entity => { const transform = draft(entity.id); return transform ? { ...entity, transform } : entity; });

export const DIRECTIONAL_DISTANCE = 50;
/** Half the side of the directional shadow box in meters (R8). */
export const SHADOW_BOX = 10;
const SHADOW_NEAR = 0.5, SHADOW_FAR = 100;
/** A spot light with range 0 casts its shadow to 50 m (B13 R3). */
export const SPOT_SHADOW_FAR = 50;

type ThreeLight = DirectionalLight | PointLight | SpotLight | AmbientLight;
export interface SceneLights {
    /** Reconciles the three.js lights with the frame. Returns true when the node sets were rebuilt, so the caller reassigns materials and compiles again. */
    apply(entities: readonly SceneEntity[]): boolean;
    /** Sets the group node set on each lit material of `root` and the shadow flags of its meshes. */
    assign(root: Object3D, group: LightGroup): void;
    /** The node set of one group; the haze material takes the `haze` set (B13 R7). */
    node(group: LightGroup): unknown;
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
    // A placed light is also on the haze layer, so the haze pass sees it; its shadow camera keeps layer 0 and the haze
    // layer, so a shadow map drawn during the haze pass still has its casters (three.js r180 example, B13 R7).
    const create = (settings: LightSettings): ThreeLight => {
        const light = build(settings);
        if ((light as AmbientLight).isAmbientLight) return light;
        const placed = light as PointLight | SpotLight | DirectionalLight;
        placed.layers.enable(HAZE_LAYER);
        placed.shadow.camera.layers.enable(HAZE_LAYER);
        return light;
    };
    const build = (settings: LightSettings): ThreeLight => {
        if (settings.type === "ambient") {
            const light = new AmbientLight(0xffffff, 1);
            scene.add(light);
            return light;
        }
        if (settings.type === "spot") {
            const light = new SpotLight(0xffffff, 1, 0, Math.PI / 6, 0, 2);
            light.shadow.mapSize.set(1024, 1024);
            light.shadow.focus = 1;
            const camera = light.shadow.camera as PerspectiveCamera;
            camera.near = 0.1; camera.far = SPOT_SHADOW_FAR;
            scene.add(light, light.target);
            return light;
        }
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
        if ((light as DirectionalLight).isDirectionalLight || (light as SpotLight).isSpotLight) (light as DirectionalLight | SpotLight).target.removeFromParent();
        light.dispose();
    };
    const update = (light: ThreeLight, entity: LightEntity): void => {
        const { light: settings, transform } = entity;
        light.color.set(settings.color);
        // A hidden light stays in its node sets with intensity 0, so a visibility change does not recompile (R7).
        light.intensity = entity.visible ? settings.intensity : 0;
        // An ambient light has no place, direction, or shadow (B13 R4).
        if ((light as AmbientLight).isAmbientLight) return;
        const cast = light as DirectionalLight | PointLight | SpotLight;
        cast.castShadow = settings.shadow.enabled;
        cast.shadow.intensity = settings.shadow.intensity;
        cast.shadow.bias = settings.shadow.bias;
        cast.shadow.normalBias = settings.shadow.normalBias;
        // Soft radius 2: radius 4 gave diagonal streaks at 2048 px in the owner's macOS check.
        cast.shadow.radius = settings.shadow.soft ? 2 : 1;
        const [x, y, z] = lightDirection(transform.rotation);
        const [px, py, pz] = transform.position;
        if ((cast as PointLight).isPointLight) {
            const point = cast as PointLight;
            point.position.set(px, py, pz);
            point.distance = settings.range;
        } else if ((cast as SpotLight).isSpotLight) {
            const spot = cast as SpotLight;
            spot.position.set(px, py, pz);
            spot.target.position.set(px + x, py + y, pz + z);
            spot.target.updateMatrixWorld(true);
            spot.distance = settings.range;
            spot.angle = spotAngle(settings.cone?.angleDegrees ?? 40);
            spot.penumbra = settings.cone?.penumbra ?? 0;
        } else {
            // The entity position is the shadow focus: the 20 m shadow box is centered on it (B12 R9).
            const directional = cast as DirectionalLight;
            directional.position.set(px - x * DIRECTIONAL_DISTANCE, py - y * DIRECTIONAL_DISTANCE, pz - z * DIRECTIONAL_DISTANCE);
            directional.target.position.set(px, py, pz);
            directional.target.updateMatrixWorld(true);
        }
        cast.updateMatrixWorld(true);
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
            const fixed = usesFixedAmbient(entities) ? [ambient] : [];
            const set = (ids: Id[]) => lights([...fixed, ...(wanted.length ? ids.map(id => owned.get(id)!.light) : [builtin])]);
            nodes = { characters: set(groups.characters), props: set(groups.props), environment: set(groups.environment), haze: lights(groups.haze.map(id => owned.get(id)!.light)) };
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
                const materials = [mesh.material ?? []].flat();
                // three.js 0.180 draws all groups of a mesh in the shadow pass through one render object; a side that differs
                // per group (MToon outline) rebuilds its pipeline on each draw (R8a).
                const side = materials[0] ? materials[0].shadowSide ?? materials[0].side : null;
                for (const material of materials.slice(1)) if ((material.shadowSide ?? material.side) !== side) material.shadowSide = side;
                for (const material of materials) {
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
        node: group => nodes?.[group] ?? null,
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
