import type { AppError } from './types';
import { cutName, materialReport, type MaterialProfile } from './materials';

// Character Debug section (R4–R13): what the glTF JSON of a loaded file says, with fixed upper sizes.
export type Row = { name: string; value: string };
export type TextureSlot = { slot: string; image: number | null; name: string; mimeType: string; bytes: number | null };
export type MaterialInfo = {
    index: number; name: string; profile: MaterialProfile; unsupported: string[]; extensions: string[]; alphaMode: string; cull: 'Off' | 'Back';
    lilToon: { specVersion: string | null; lilToonVersion: string | null; shaderVariant: string | null; renderQueue: number | null } | null;
    properties: Row[]; textures: TextureSlot[];
};
export type ModelInfo = {
    format: { vrm: string | null; generator: string | null; gltf: string | null };
    extensions: { name: string; required: boolean }[];
    meta: Row[];
    counts: { key: string; value: number }[];
    materials: MaterialInfo[];
};
/** The decoded size and color space of one texture slot of a live material. */
export type LiveTexture = { material: number; slot: string; width: number; height: number; colorSpace: string };
export type AssetDebug = { info: ModelInfo; textures: LiveTexture[]; warnings: AppError[] };

export const MODEL_INFO_LIMITS = { extensions: 64, meta: 32, materials: 256, properties: 1024, textures: 32, warnings: 64, value: 256 } as const;
const LILTOON = 'MOCHIYA_materials_liltoon';
const CORE_SLOTS = ['normalTexture', 'occlusionTexture', 'emissiveTexture'];
const PBR_SLOTS = ['baseColorTexture', 'metallicRoughnessTexture'];

type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === 'string' ? cutName(value, MODEL_INFO_LIMITS.value) : null;
const scalar = (value: unknown): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value);
const show = (value: unknown): string | null => {
    if (scalar(value)) return cutName(String(value), MODEL_INFO_LIMITS.value);
    if (Array.isArray(value) && value.every(scalar)) return cutName(value.join(', '), MODEL_INFO_LIMITS.value);
    return null;
};

// Nested keys join with `.`; an array of plain values is one row.
const flatten = (value: unknown, prefix: string, rows: Row[], skip: (key: string) => boolean = () => false) => {
    if (rows.length >= MODEL_INFO_LIMITS.properties) return;
    const shown = show(value);
    if (shown !== null || value === null) { rows.push({ name: cutName(prefix, MODEL_INFO_LIMITS.value), value: shown ?? 'null' }); return; }
    const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(object(value) ?? {});
    for (const [key, item] of entries) if (!skip(key)) flatten(item, prefix ? `${prefix}.${key}` : key, rows);
};

const metaRows = (meta: Json): Row[] => Object.entries(meta).flatMap(([name, value]) => {
    const shown = show(value);
    return shown === null ? [] : [{ name: cutName(name), value: shown }];
}).slice(0, MODEL_INFO_LIMITS.meta);

const textureSlots = (root: Json, material: Json, v0: Json | undefined): TextureSlot[] => {
    const textures = array(root.textures), images = array(root.images), views = array(root.bufferViews);
    const slot = (name: string, texture: unknown): TextureSlot => {
        const source = typeof texture === 'number' ? object(textures[texture])?.source : undefined;
        const image = typeof source === 'number' ? object(images[source]) : undefined;
        const view = typeof image?.bufferView === 'number' ? object(views[image.bufferView]) : undefined;
        return { slot: cutName(name), image: image && typeof source === 'number' ? source : null, name: text(image?.name) ?? '', mimeType: text(image?.mimeType) ?? '',
            bytes: typeof view?.byteLength === 'number' ? view.byteLength : null };
    };
    const slots: TextureSlot[] = [];
    const ref = (name: string, value: unknown) => { const index = object(value)?.index; if (typeof index === 'number') slots.push(slot(name, index)); };
    const pbr = object(material.pbrMetallicRoughness);
    for (const name of PBR_SLOTS) ref(name, pbr?.[name]);
    for (const name of CORE_SLOTS) ref(name, material[name]);
    for (const [extension, value] of Object.entries(object(material.extensions) ?? {})) {
        const body = object(value) ?? {};
        if (extension === LILTOON) for (const [name, texture] of Object.entries(object(body.textures) ?? {})) ref(name, texture);
        else for (const [name, texture] of Object.entries(body)) ref(name, texture);
    }
    for (const [name, index] of Object.entries(object(v0?.textureProperties) ?? {})) if (typeof index === 'number') slots.push(slot(name, index));
    return slots.slice(0, MODEL_INFO_LIMITS.textures);
};

const properties = (material: Json, v0: Json | undefined): Row[] => {
    const rows: Row[] = [];
    flatten(material, '', rows, key => key === 'extensions' || key === 'name' || key === 'extras');
    for (const [extension, value] of Object.entries(object(material.extensions) ?? {})) {
        if (extension !== LILTOON) { flatten(value, extension, rows); continue; }
        const body = object(value) ?? {};
        flatten(body, extension, rows, key => key === 'properties' || key === 'textures');
        for (const [name, item] of Object.entries(object(body.properties) ?? {})) flatten(item, name, rows);
    }
    if (v0) {
        flatten(v0.shader, 'shader', rows);
        flatten(v0.renderQueue, 'renderQueue', rows);
        for (const group of ['floatProperties', 'vectorProperties', 'keywordMap', 'tagMap'])
            for (const [name, item] of Object.entries(object(v0[group]) ?? {})) flatten(item, name, rows);
    }
    return rows.slice(0, MODEL_INFO_LIMITS.properties);
};

const countOf = (value: unknown) => Array.isArray(value) ? value.length : Object.keys(object(value) ?? {}).length;

export function modelInfo(json: unknown): ModelInfo {
    const root = object(json) ?? {};
    const asset = object(root.asset) ?? {};
    const extensions = object(root.extensions) ?? {};
    const vrm1 = object(extensions.VRMC_vrm), vrm0 = object(extensions.VRM);
    const spring = object(extensions.VRMC_springBone), secondary = object(vrm0?.secondaryAnimation);
    const required = new Set(array(root.extensionsRequired));
    const meshes = array(root.meshes), nodes = array(root.nodes);
    const joints = new Set(array(root.skins).flatMap(skin => array(object(skin)?.joints)));
    const expressions = object(vrm1?.expressions);
    const counts: Record<string, number> = {
        nodes: nodes.length,
        meshes: meshes.length,
        primitives: meshes.reduce<number>((sum, mesh) => sum + array(object(mesh)?.primitives).length, 0),
        materials: array(root.materials).length,
        textures: array(root.textures).length,
        images: array(root.images).length,
        skins: array(root.skins).length,
        joints: joints.size,
        humanoidBones: countOf(object(vrm1?.humanoid ?? vrm0?.humanoid)?.humanBones),
        expressions: vrm1 ? countOf(expressions?.preset) + countOf(expressions?.custom) : array(object(vrm0?.blendShapeMaster)?.blendShapeGroups).length,
        springs: spring ? array(spring.springs).length : array(secondary?.boneGroups).length,
        colliders: spring ? array(spring.colliders).length : array(secondary?.colliderGroups).reduce<number>((sum, group) => sum + array(object(group)?.colliders).length, 0),
        constraints: nodes.filter(node => object(object(node)?.extensions)?.VRMC_node_constraint !== undefined).length,
        animations: array(root.animations).length,
    };
    const v0Materials = array(vrm0?.materialProperties);
    const materials = array(root.materials);
    return {
        format: { vrm: vrm1 ? text(vrm1.specVersion) ?? '1.0' : vrm0 ? '0.x' : null, generator: text(asset.generator), gltf: text(asset.version) },
        extensions: array(root.extensionsUsed).filter((name): name is string => typeof name === 'string').slice(0, MODEL_INFO_LIMITS.extensions)
            .map(name => ({ name: cutName(name), required: required.has(name) })),
        meta: metaRows(object(vrm1?.meta ?? vrm0?.meta) ?? {}),
        counts: Object.entries(counts).map(([key, value]) => ({ key, value })),
        materials: materialReport(json).materials.slice(0, MODEL_INFO_LIMITS.materials).map(entry => {
            const material = object(materials[entry.index]) ?? {};
            const v0 = object(v0Materials[entry.index]);
            const lil = object(object(material.extensions)?.[LILTOON]);
            return {
                ...entry,
                extensions: Object.keys(object(material.extensions) ?? {}).map(name => cutName(name)),
                alphaMode: text(material.alphaMode) ?? 'OPAQUE',
                cull: material.doubleSided === true ? 'Off' : 'Back',
                lilToon: entry.profile === 'liltoon' && lil ? { specVersion: text(lil.specVersion), lilToonVersion: text(lil.lilToonVersion), shaderVariant: text(lil.shaderVariant),
                    renderQueue: typeof lil.renderQueue === 'number' ? lil.renderQueue : null } : null,
                properties: properties(material, v0),
                textures: textureSlots(root, material, v0),
            };
        }),
    };
}
