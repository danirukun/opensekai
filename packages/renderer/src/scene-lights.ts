import { AmbientLight, Color, DirectionalLight, MathUtils, PointLight, PCFShadowMap, SpotLight, type Light, type LightsNode, type Material, type Object3D, type OrthographicCamera, type PerspectiveCamera, type Scene, type WebGPURenderer } from "three/webgpu";
import { lights } from "three/tsl";
import DynamicLightsNode from "three/addons/tsl/lighting/DynamicLightsNode.js";
import type { Id, LightSettings, SceneEntity, Transform, Vec3 } from "@opensekai/contracts";
import { LIMITS, rotateByQuaternion } from "@opensekai/contracts";
import { HAZE_LAYER } from "./haze";

/** r187 `DynamicLightsNode` batches only the exact three.js light classes, so a directional light keeps the per-light path
 * and the lilToon main light stays the first directional light (light scale TB3 (b)). */
export class GroupDirectionalLight extends DirectionalLight {}

/** The lights node of a material group: point, spot, and ambient lights without a shadow go into uniform arrays, so a change
 * of them changes no program (light scale R13, R14). The throwaway lights make the three data nodes now, so the first light
 * of a type does not change the program either (R15). */
export const batchedLights = (list: Light[]): DynamicLightsNode => {
    const node = new DynamicLightsNode({ maxPointLights: LIMITS.litLights, maxSpotLights: LIMITS.litLights });
    node.setLights([new PointLight(), new SpotLight(), new AmbientLight()]);
    node.setLights(list);
    return node;
};

/** A light that a group node batches; all others (directional, or with a shadow) are per-light members (light scale R13). */
const isBatched = (light: LightSettings): boolean => light.type === "ambient" || (light.type !== "directional" && !light.shadow.enabled);

export type LightGroup = "characters" | "props" | "environment" | "haze";
export type LightGroups = Record<LightGroup, Id[]>;
type LightEntity = Extract<SceneEntity, { kind: "light" }>;
const LIGHT_GROUPS: readonly LightGroup[] = ["characters", "props", "environment", "haze"];

/** ENV-01: the maximum number of file lights that may cast shadows. */
export const MAX_FILE_LIGHT_SHADOWS = 2;

export const isLight = (entity: SceneEntity): entity is LightEntity => entity.kind === "light";
export const groupOf = (entity: SceneEntity): LightGroup | null =>
    entity.kind === "avatar" ? "characters" : entity.kind === "mesh" ? "props" : entity.kind === "environment" ? "environment" : null;

/** A point or spot light with `volumetric` scatters in haze; three.js ignores lights without a distance (B13 R1, R7). */
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

/** The share of the scene ambient that the MToon lighting model of an avatar keeps; the environment fill adds the rest (character lighting R4). */
export const CHARACTER_AMBIENT = 0.5;

/** What the room map of the environment gives (B13 R4a): its diffuse fill (0 or 1) and the linear multiplier of its reflections. */
export interface RoomLight { fill: number; reflections: Vec3 }
/** Without an ambient entity the room map stays as it is under the fixed white ambient. With one, the ambient entities give the
 * fill, and the reflections follow the ambient light on the environment (B13 R4a). */
export function roomLight(entities: readonly SceneEntity[]): RoomLight {
    if (usesFixedAmbient(entities)) return { fill: 1, reflections: [1, 1, 1] };
    const reflections = entities.filter(isLight).filter(e => e.light.type === "ambient" && e.visible && e.light.affectEnvironment)
        .reduce<Vec3>((sum, e) => { const { r, g, b } = new Color(e.light.color); const k = e.light.intensity; return [sum[0] + r * k, sum[1] + g * k, sum[2] + b * k]; }, [0, 0, 0]);
    return { fill: 0, reflections };
}

/** The three.js spot angle (half the cone) in radians, from the full cone angle in degrees (B13 R3). */
export const spotAngle = (angleDegrees: number): number => MathUtils.degToRad(angleDegrees / 2);

/** The values that rebuild the node sets (R7): the light count and order, each type, affect flag, and shadow switch. Visibility, color, intensity, range, and transform are not part of it.
 *  ENV-01: includes the environment allowLightsToAffectCharacters flag and assetId so an env swap or flag change triggers a rebuild. */
export function lightSignature(entities: readonly SceneEntity[]): string {
    const all = entities.filter(isLight);
    const env = entities.find((e): e is Extract<SceneEntity, { kind: "environment" }> => e.kind === "environment");
    const envFlag = env?.allowLightsToAffectCharacters === true;
    const envAsset = env?.assetId ?? "";
    if (!all.length) {
        if (!env) return "builtin";
        const base = envFlag ? "builtin:envChars" : "builtin";
        return envAsset ? `${base}:envAsset:${envAsset}` : base;
    }
    return JSON.stringify([envFlag, envAsset, all.map(({ id, light: l }) => [id, l.type, l.affectCharacters, l.affectProps, l.affectEnvironment, l.shadow.enabled, scattersInHaze(l)])]);
}

/** ENV-01 R3: cap file-light shadows to 2 (first two with castShadow in traversal order). */
export function capFileLightShadows(root: Object3D): void {
    let count = 0;
    root.traverse(object => {
        const light = object as Object3D & { isLight?: boolean; castShadow?: boolean };
        if (!light.isLight) return;
        if (light.castShadow) {
            count++;
            if (count > MAX_FILE_LIGHT_SHADOWS) light.castShadow = false;
        }
    });
}

/** ENV-01 R5: collect three.js lights from the environment root into the right groups. */
export function collectFileLights(root: Object3D): Light[] {
    const result: Light[] = [];
    root.traverse(object => {
        const light = object as Object3D & { isLight?: boolean };
        if (light.isLight) result.push(light as Light);
    });
    return result;
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
    /** Reconciles the three.js lights with the frame. Returns true when the light signature changes, so the caller resets the failure state and compiles again. Only a group whose per-light members (material groups, light scale R16) or light list (haze, light limits R13) changed gets a new node. */
    apply(entities: readonly SceneEntity[]): boolean;
    /** ENV-01: sets the file lights from the loaded environment root and whether they affect characters. */
    setFileLights(fileLights: readonly Light[], affectCharacters: boolean): void;
    /** Sets the group node set on each lit material of `root` and the shadow flags of its meshes. */
    assign(root: Object3D, group: LightGroup): void;
    /** Draws the shadow map of each named light with a shadow in the next render (light scale R22). */
    markShadows(dirty: ReadonlySet<Id>): void;
    /** The node set of one group; the haze material takes the `haze` set (B13 R7). */
    node(group: LightGroup): unknown;
    signature(): string;
    /** Increases when a group gets a new node object, so an A → B → A change still reassigns materials that hold the old nodes. */
    generation(): number;
    shadows(): boolean;
    dispose(): void;
}

// A lit material: standard, physical, Phong, Lambert, toon, MToon, or lilToon. Unlit materials keep scene lights, which they ignore.
export const isLitMaterial = (material: Material): boolean => {
    const m = material as Material & Record<string, unknown>;
    return m.isMeshStandardMaterial === true || m.isMeshPhongMaterial === true || m.isMeshLambertMaterial === true || m.isMeshToonMaterial === true || m.isMToonNodeMaterial === true || m.isMToonMaterial === true || m.isLilToonNodeMaterial === true;
};

export function createSceneLights(scene: Scene, renderer: WebGPURenderer): SceneLights {
    const ambient = new AmbientLight(0xffffff, 1);
    // The built-in light (R5): it lights all materials when the scene has no light entity.
    const builtin = new GroupDirectionalLight(0xffffff, 3);
    builtin.position.set(2, 4, 3);
    scene.add(ambient, builtin, builtin.target);
    renderer.shadowMap.type = PCFShadowMap;
    const owned = new Map<Id, { type: LightSettings["type"]; light: ThreeLight }>();
    let current = "", generation = 0, nodes: Record<LightGroup, LightsNode> | null = null, keys: Record<LightGroup, string> | null = null, shadows = false;
    // ENV-01: file lights from the loaded environment root.
    let fileLightObjects: readonly Light[] = [], fileLightsAffectCharacters = false;
    // A placed light is also on the haze layer, so the haze pass sees it; its shadow camera keeps layer 0 and the haze
    // layer, so a shadow map drawn during the haze pass still has its casters (three.js example, B13 R7).
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
        const light = new GroupDirectionalLight(0xffffff, 1);
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
        // The renderer marks a map only when its contents change (light scale R22).
        cast.shadow.autoUpdate = false;
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
            // File-light identity (uuid list) so equal counts with different objects still rebuild.
            const fileIds = fileLightObjects.map(light => light.uuid).join(",");
            const signature = lightSignature(entities) + `:fl${fileIds}:${fileLightsAffectCharacters}`;
            if (signature === current && nodes) return false;
            current = signature;
            const groups = lightGroups(entities);
            const fixedAmbient = usesFixedAmbient(entities), builtinOn = !wanted.length;
            const settings = new Map(wanted.map(e => [e.id, e.light]));
            const members = (ids: Id[]) => ids.map(id => [id, settings.get(id)!.type, settings.get(id)!.shadow.enabled]);
            // The haze keeps its node while its light list stays the same (light limits R13). A material group keeps its node
            // while its per-light members stay the same, and gets its new batched lights through `setLights` (light scale R16).
            // File lights join environment always and characters when the flag is on; their identity is part of those keys.
            const fileKey = (group: LightGroup) =>
                group === "environment" || (group === "characters" && fileLightsAffectCharacters) ? fileIds : "";
            const nextKeys = Object.fromEntries(LIGHT_GROUPS.map(group => [group, JSON.stringify(group === "haze" ? members(groups.haze) : [builtinOn, members(groups[group].filter(id => !isBatched(settings.get(id)!))), fileKey(group)])])) as Record<LightGroup, string>;
            // ENV-01 R5: file lights always go to environment, optionally to characters, never to props or haze.
            const fileExtra = (group: LightGroup): Light[] => group === "environment" || (group === "characters" && fileLightsAffectCharacters) ? [...fileLightObjects] : [];
            const list = (group: LightGroup): Light[] => [...(fixedAmbient ? [ambient] : []), ...(builtinOn ? [builtin] : groups[group].map(id => owned.get(id)!.light)), ...fileExtra(group)];
            const previous = nodes;
            const kept = (group: LightGroup) => previous && keys?.[group] === nextKeys[group] ? previous[group] : null;
            const build = (group: LightGroup): LightsNode => group === "haze" ? lights(groups.haze.map(id => owned.get(id)!.light)) : batchedLights(list(group));
            nodes = Object.fromEntries(LIGHT_GROUPS.map(group => [group, kept(group) ?? build(group)])) as Record<LightGroup, LightsNode>;
            for (const group of LIGHT_GROUPS) if (group !== "haze" && nodes[group] === previous?.[group]) nodes[group].setLights(list(group));
            if (!previous || LIGHT_GROUPS.some(group => nodes![group] !== previous[group])) generation += 1;
            keys = nextKeys;
            const fileShadows = fileLightObjects.some(light => light.castShadow);
            shadows = shadowsOn(entities) || fileShadows;
            renderer.shadowMap.enabled = shadows;
            return true;
        },
        setFileLights(newFileLights, affectCharacters) {
            fileLightObjects = newFileLights;
            fileLightsAffectCharacters = affectCharacters;
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
        markShadows(dirty) {
            for (const id of dirty) {
                const cast = owned.get(id)?.light as DirectionalLight | PointLight | SpotLight | undefined;
                if (cast?.castShadow) cast.shadow.needsUpdate = true;
            }
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
            keys = null;
        },
    };
}
