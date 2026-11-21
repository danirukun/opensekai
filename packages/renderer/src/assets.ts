import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { LoadReport } from "./load-jobs";
import { MToonMaterialLoaderPlugin, VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { CharacterMToonMaterial } from "./character-mtoon";
import { CharacterLilToonMaterial } from "./character-liltoon";
import { enableLilToonNodeVRM, type LilToonNodeWarning } from "@mochiya/three-liltoon/webgpu";
import { MODEL_INFO_LIMITS, materialEntries, materialReport, materialWarning, meshEntries, modelInfo, type AssetDebug, type LiveTexture, type ModelInfo, type ResourceHost, type AppError } from "@opensekai/contracts";
import type { Object3D, Mesh, SkinnedMesh, Material, Texture } from "three/webgpu";
import { failure } from "./apply-frame";
import { createTexturePool } from "./texture-sharing";
import { createImageResizePolicy } from "./image-resize";
import { supportNodeMaterialColorBinds } from "./mtoon-binds";
supportNodeMaterialColorBinds();
// B43 R14: spring bones run in the renderer; node constraints and spring bone limits do not.
export function extensionWarnings(extensions: readonly string[], id: string): AppError[] {
    return extensions.flatMap((extension): AppError[] =>
        extension === "VRMC_node_constraint" ? [{ code: "UNSUPPORTED", message: "VRMC_node_constraint simulation is disabled in renderer", ids: [id] }]
        : extension === "VRMC_springBone_limit" ? [{ code: "UNSUPPORTED", message: "VRMC_springBone_limit is not supported; spring bones move without limits", ids: [id] }]
        : []);
}
export function createAssetCache<T extends {
    dispose(): void;
}>(load: (id: string) => Promise<T>) {
    let closed = false;
    const entries = new Map<string, {
        promise: Promise<T>;
        value?: T;
        released: boolean;
    }>();
    const release = (id: string) => { const entry = entries.get(id); if (!entry)
        return; entries.delete(id); entry.released = true; entry.value?.dispose(); };
    return {
        get(id: string): Promise<T> {
            if (closed)
                return Promise.reject(failure("CANCELLED", "Asset cache disposed"));
            const existing = entries.get(id);
            if (existing)
                return existing.promise;
            const entry: {
                promise: Promise<T>;
                value?: T;
                released: boolean;
            } = { promise: undefined!, released: false };
            entry.promise = load(id).then(value => { if (entry.released || closed) {
                value.dispose();
                throw failure("CANCELLED", "Asset load cancelled", [id]);
            } entry.value = value; return value; }, error => { if (entries.get(id) === entry)
                entries.delete(id); throw error; });
            entries.set(id, entry);
            return entry.promise;
        },
        size: () => entries.size,
        release, retainOnly(ids: ReadonlySet<string>) { for (const id of [...entries.keys()]) if (!ids.has(id)) release(id); }, dispose() { if (closed)
            return; closed = true; for (const id of [...entries.keys()])
            release(id); }
    };
}
export function disposeObject(root: Object3D, shared?: { textures: ReadonlySet<Texture>; ownsImage(image: unknown): boolean }) {
    const resources = new Set<{
        dispose(): void;
    }>();
    const images = new Set<ImageBitmap>();
    root.traverse(object => { const mesh = object as Mesh; if (mesh.geometry)
        resources.add(mesh.geometry); const skeleton = (object as SkinnedMesh).skeleton; if (skeleton)
        resources.add(skeleton); for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        if (!material)
            continue;
        resources.add(material);
        for (const value of Object.values(material as Material)) {
            const texture = value as Texture | undefined;
            if (texture?.isTexture) {
                if (!shared?.textures.has(texture)) resources.add(texture);
                if (!shared?.ownsImage(texture.image) && typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap)
                    images.add(texture.image);
            }
        }
    } });
    root.removeFromParent();
    for (const resource of resources)
        resource.dispose();
    for (const image of images)
        image.close();
}
export function inspectContainer(bytes: ArrayBuffer): { extensions: string[]; imageCount: number; json: unknown } {
    const view = new DataView(bytes);
    if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== view.byteLength)
        throw failure("INVALID_INPUT", "Expected self-contained GLB");
    const size = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || size > view.byteLength - 20)
        throw failure("INVALID_INPUT", "Invalid GLB JSON");
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size))) as {
        buffers?: {
            uri?: string;
        }[];
        images?: {
            uri?: string;
        }[];
        extensionsUsed?: string[];
    };
    if ([...json.buffers ?? [], ...json.images ?? []].some(x => x.uri !== undefined))
        throw failure("UNSUPPORTED", "External or URI resources are not supported");
    return { extensions: json.extensionsUsed ?? [], imageCount: json.images?.length ?? 0, json };
}
// B26 R7: the object of each mesh node, by its mesh name. A node with two or more primitives loads as a group; the map holds
// the node object. glTF has no hidden node state, so each object starts visible.
export function meshObjects(gltf: { scene: Object3D; parser: { json: unknown; associations: Map<unknown, { nodes?: number }> } }): Map<string, Object3D> {
    const byNode = new Map<number, Object3D>();
    gltf.scene.traverse(object => { const node = gltf.parser.associations.get(object)?.nodes; if (node !== undefined && !byNode.has(node)) byNode.set(node, object); });
    return new Map(meshEntries(gltf.parser.json).flatMap(entry => { const object = byNode.get(entry.node); return object ? [[entry.name, object] as const] : []; }));
}
// Children of a hidden node are hidden with it. An unknown name has no effect.
export function applyHiddenMeshes(meshes: ReadonlyMap<string, Object3D>, hidden: readonly string[] = []) {
    const names = new Set(hidden);
    for (const [name, object] of meshes) object.visible = !names.has(name);
}
// Character Debug R10: three material fields by the glTF slot name of the file. A MToon field has the name of its VRMC_materials_mtoon slot.
const CORE_SLOTS: Record<string, string> = { map: "baseColorTexture", normalMap: "normalTexture", emissiveMap: "emissiveTexture", aoMap: "occlusionTexture", metalnessMap: "metallicRoughnessTexture" };
type LiveMaterial = Material & { getTexture?: (name: string) => Texture | null };
const liveTexture = (material: number, slot: string, texture: Texture | null | undefined): LiveTexture[] => {
    const image = texture?.image as { width?: unknown; height?: unknown } | undefined;
    // The lilToon material gives a neutral 1 x 1 texture for a slot with no texture.
    if (!texture || texture.name.startsWith("three-liltoon:") || typeof image?.width !== "number" || typeof image.height !== "number") return [];
    return [{ material, slot, width: image.width, height: image.height, colorSpace: texture.colorSpace || "none" }];
};
/** The decoded size and color space of the texture of each slot, read from the live materials of the parsed file. */
export function liveTextures(scene: Object3D, associations: Map<unknown, { materials?: number }>, info: ModelInfo): LiveTexture[] {
    const seen = new Set<number>();
    const result: LiveTexture[] = [];
    scene.traverse(object => {
        const value = (object as Mesh).material;
        for (const material of (Array.isArray(value) ? value : value ? [value] : []) as LiveMaterial[]) {
            const index = associations.get(material)?.materials;
            if (index === undefined || seen.has(index)) continue;
            seen.add(index);
            const slots = info.materials.find(entry => entry.index === index)?.textures ?? [];
            if (material.getTexture) for (const { slot } of slots) result.push(...liveTexture(index, slot, material.getTexture(slot)));
            else for (const [field, texture] of Object.entries(material)) if ((texture as Texture | null)?.isTexture) result.push(...liveTexture(index, CORE_SLOTS[field] ?? field, texture as Texture));
        }
    });
    return result;
}
export function createAssetLoader(resources: ResourceHost, options: { maxTextureSize?: 1024 | 2048 } = {}) {
    const textures = createTexturePool();
    const images = createImageResizePolicy(options.maxTextureSize);
    return async (id: string, report: (report: LoadReport) => void = () => {}) => {
        const lease = textures.acquire(id);
        const loader = new GLTFLoader();
        let imageFailure: unknown;
        let imageTotal = 0;
        const decoded = new Set<number>();
        loader.register(parser => {
            // Share decoding before GLTFLoader allocates another bitmap; keep each parser and texture wrapper independent.
            const decode = parser.loadImageSource.bind(parser);
            parser.loadImageSource = (index, imageLoader) => lease.load(index, () => images.decode(() => decode(index, imageLoader))).then(texture => {
                if (imageTotal > 0 && !decoded.has(index)) {
                    decoded.add(index);
                    report({ stage: 'textures', progress: decoded.size / imageTotal, count: { done: decoded.size, total: imageTotal } });
                }
                return texture;
            }).catch(error => { imageFailure = error; throw error; });
            return { name: "OPENSEKAI_shared_images" };
        });
        const lilToon: LilToonNodeWarning[] = [];
        loader.register(parser => {
            const plugin = new VRMLoaderPlugin(parser, { mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, { materialType: CharacterMToonMaterial }) });
            // lilToon on WebGPU R6: only a VRM file loads the lilToon extension. A GLB prop keeps the PBR path, and the material
            // report names the extension. The lilToon plugin goes first, so a lilToon material with MToon data gets no MToon material.
            const used: unknown[] = parser.json.extensionsUsed ?? [];
            return used.includes("VRMC_vrm") || used.includes("VRM") ? enableLilToonNodeVRM(plugin, { materialType: CharacterLilToonMaterial, onWarning: warning => lilToon.push(warning) }) : plugin;
        });
        try {
            let percent = -1;
            report({ stage: 'download', progress: null });
            const bytes = await resources.readAsset(id, (loaded, total) => {
                const progress = total ? Math.min(1, loaded / total) : null;
                const next = progress === null ? -1 : Math.floor(progress * 100);
                if (next !== percent) { percent = next; report({ stage: 'download', progress }); }
            });
            // The report reads the JSON of the bytes: v0compat replaces VRM 0.x entries of parser.json.materials during the parse.
            const { extensions, imageCount, json } = inspectContainer(bytes);
            const material = materialWarning(materialReport(json));
            const info = modelInfo(json);
            // The record materials (B38 R28): the renderer binds the saved values by these names.
            const materials = materialEntries(json);
            imageTotal = imageCount;
            if (imageTotal > 0) report({ stage: 'textures', progress: 0, count: { done: 0, total: imageTotal } });
            const gltf = await loader.parseAsync(bytes, "");
            // GLTFLoader converts image failures to null maps; reject the asset instead.
            if (imageFailure) { disposeObject(gltf.scene, lease); throw imageFailure; }
            const vrm = gltf.userData.vrm as VRM | undefined;
            if (vrm) VRMUtils.rotateVRM0(vrm);
            const warnings: AppError[] = [];
            warnings.push(...extensionWarnings(extensions, id));
            if (material) warnings.push({ code: "UNSUPPORTED", message: material, ids: [id] });
            for (const warning of lilToon) warnings.push({ code: "UNSUPPORTED", message: `lilToon ${warning.materialName} (${warning.property}): ${warning.message}`, ids: [id] });
            const debug: AssetDebug = { info, textures: liveTextures(gltf.scene, gltf.parser.associations, info), warnings: warnings.slice(0, MODEL_INFO_LIMITS.warnings) };
            let disposed = false;
            const associations = gltf.parser.associations as Map<unknown, { materials?: number }>;
            const materialIndex = (material: Material) => associations.get(material)?.materials;
            return { scene: gltf.scene, vrm, meshes: vrm ? meshObjects(gltf) : undefined, materials, materialIndex, warnings, debug, dispose() { if (disposed)
                    return; disposed = true; disposeObject(gltf.scene, lease); lease.release(); } };
        } catch (error) {
            lease.release();
            throw error;
        }
    };
}
