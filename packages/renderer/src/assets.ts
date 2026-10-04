import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MToonMaterialLoaderPlugin, VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { MToonNodeMaterial } from "@pixiv/three-vrm/nodes";
import type { ResourceHost, AppError } from "@opensekai/contracts";
import type { Object3D, Mesh, SkinnedMesh, Material, Texture } from "three/webgpu";
import { failure } from "./apply-frame";
import { createTexturePool } from "./texture-sharing";
import { createImageResizePolicy } from "./image-resize";
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
export function inspectContainer(bytes: ArrayBuffer): string[] {
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
    return json.extensionsUsed ?? [];
}
export function createAssetLoader(resources: ResourceHost, options: { maxTextureSize?: 1024 | 2048 } = {}) {
    const textures = createTexturePool();
    const images = createImageResizePolicy(options.maxTextureSize);
    return async (id: string) => {
        const lease = textures.acquire(id);
        const loader = new GLTFLoader();
        let imageFailure: unknown;
        loader.register(parser => {
            // Share decoding before GLTFLoader allocates another bitmap; keep each parser and texture wrapper independent.
            const decode = parser.loadImageSource.bind(parser);
            parser.loadImageSource = (index, imageLoader) => lease.load(index, () => images.decode(() => decode(index, imageLoader))).catch(error => { imageFailure = error; throw error; });
            return { name: "OPENSEKAI_shared_images" };
        });
        loader.register(parser => new VRMLoaderPlugin(parser, { mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial }) }));
        try {
            const bytes = await resources.readAsset(id);
            const extensions = inspectContainer(bytes);
            const gltf = await loader.parseAsync(bytes, "");
            // GLTFLoader converts image failures to null maps; reject the asset instead.
            if (imageFailure) { disposeObject(gltf.scene, lease); throw imageFailure; }
            const vrm = gltf.userData.vrm as VRM | undefined;
            if (vrm) VRMUtils.rotateVRM0(vrm);
            const warnings: AppError[] = [];
            for (const extension of extensions) {
                if (extension === "VRMC_node_constraint" || extension === "VRMC_springBone")
                    warnings.push({ code: "UNSUPPORTED", message: extension + " simulation is disabled in renderer", ids: [id] });
            }
            let disposed = false;
            return { scene: gltf.scene, vrm, warnings, dispose() { if (disposed)
                    return; disposed = true; disposeObject(gltf.scene, lease); lease.release(); } };
        } catch (error) {
            lease.release();
            throw error;
        }
    };
}
