import { MAX_MATERIALS, MAX_MATERIAL_NAME, appliedParameters, type AssetMaterial, type MaterialParameter, type MaterialShape } from './material-parameters';
import { uniqueName } from './meshes';

// Material report (MAT-01 slice 1, R1–R2): the material profile and the unsupported features of each material,
// read from the glTF JSON of the stored file.
export type MaterialProfile = 'mtoon' | 'unlit' | 'pbr';
export type MaterialReportEntry = {index: number; name: string; profile: MaterialProfile; unsupported: string[]};
export type MaterialReport = {materials: MaterialReportEntry[]; asset: string[]};

/** Material extensions that the pinned three 0.187.0 GLTFLoader and three-vrm 3.5.5 read. */
export const MATERIAL_EXTENSIONS: ReadonlySet<string> = new Set([
    'KHR_materials_anisotropy', 'KHR_materials_clearcoat', 'KHR_materials_diffuse_roughness', 'KHR_materials_dispersion',
    'KHR_materials_emissive_strength', 'KHR_materials_ior', 'KHR_materials_iridescence', 'KHR_materials_sheen',
    'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_unlit', 'KHR_materials_volume', 'EXT_materials_bump',
    'VRMC_materials_mtoon', 'VRMC_materials_hdr_emissiveMultiplier',
]);
/** Texture extensions that need a decoder this renderer does not give. */
export const TEXTURE_DECODERS_MISSING: ReadonlySet<string> = new Set(['KHR_texture_basisu']);
const MTOON_READS = new Set(['VRMC_materials_mtoon', 'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'VRMC_materials_hdr_emissiveMultiplier']);
const ASSET_FEATURES = ['KHR_materials_variants'];
const CORE_TEXTURES = ['normalTexture', 'occlusionTexture', 'emissiveTexture'];
const PBR_TEXTURES = ['baseColorTexture', 'metallicRoughnessTexture'];

type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Cuts a string to 64 UTF-16 units without a cut surrogate pair. */
export const cutName = (value: string, max = 64) => {
    if (value.length <= max) return value;
    const code = value.charCodeAt(max - 1);
    return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
};

const textureRefs = (material: Json): number[] => {
    const refs: number[] = [];
    const ref = (value: unknown) => { const index = object(value)?.index; if (typeof index === 'number') refs.push(index); };
    const pbr = object(material.pbrMetallicRoughness);
    for (const key of PBR_TEXTURES) ref(pbr?.[key]);
    for (const key of CORE_TEXTURES) ref(material[key]);
    const walk = (value: unknown) => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        const node = object(value);
        if (!node) return;
        ref(node);
        for (const child of Object.values(node)) walk(child);
    };
    for (const extension of Object.values(object(material.extensions) ?? {})) walk(extension);
    return refs;
};

export function materialReport(json: unknown): MaterialReport {
    const root = object(json) ?? {};
    const textures = array(root.textures);
    const v0 = array(object(object(root.extensions)?.VRM)?.materialProperties);
    const materials = array(root.materials).map((value, index): MaterialReportEntry => {
        const material = object(value) ?? {};
        const extensions = Object.keys(object(material.extensions) ?? {});
        const shader = object(v0[index])?.shader;
        const v0Shader = typeof shader === 'string' ? shader : undefined;
        const mtoon = extensions.includes('VRMC_materials_mtoon') || v0Shader === 'VRM/MToon';
        const profile: MaterialProfile = mtoon ? 'mtoon'
            : extensions.includes('KHR_materials_unlit') || v0Shader?.startsWith('VRM/Unlit') ? 'unlit' : 'pbr';
        const unsupported = new Set<string>();
        for (const name of extensions) if (!MATERIAL_EXTENSIONS.has(name) || (mtoon && !MTOON_READS.has(name))) unsupported.add(cutName(name));
        if (v0Shader !== undefined && v0Shader !== 'VRM/MToon' && !v0Shader.startsWith('VRM/Unlit') && v0Shader !== 'VRM_USE_GLTFSHADER')
            unsupported.add(cutName('shader:' + v0Shader));
        for (const ref of textureRefs(material)) {
            const texture = object(textures[ref]);
            const used = object(texture?.extensions) ?? {};
            for (const name of TEXTURE_DECODERS_MISSING) if (name in used && typeof texture?.source !== 'number') unsupported.add(name);
        }
        const raw = typeof material.name === 'string' ? material.name.trim() : '';
        return {index, name: cutName(raw || `Material ${index}`), profile, unsupported: [...unsupported].sort()};
    });
    const used = new Set(array(root.extensionsUsed).filter((x): x is string => typeof x === 'string'));
    return {materials, asset: ASSET_FEATURES.filter(name => used.has(name)).sort()};
}

/** The load warning text for a report, or null when nothing is unsupported (R3). */
export function materialWarning(report: MaterialReport): string | null {
    const flagged = report.materials.filter(entry => entry.unsupported.length > 0);
    if (flagged.length === 0 && report.asset.length === 0) return null;
    // At most 16 entries of at most 8 features each, so the message has a fixed upper size.
    const features = (list: string[]) => list.slice(0, 8).join(', ') + (list.length > 8 ? `, and ${list.length - 8} more` : '');
    const parts = flagged.slice(0, 16).map(entry => `${entry.name} (${features(entry.unsupported)})`);
    if (flagged.length > 16) parts.push(`and ${flagged.length - 16} more`);
    if (report.asset.length > 0) parts.push(`asset (${report.asset.join(', ')})`);
    return 'Unsupported material features: ' + parts.join('; ');
}

// Material list (B38 R13, R15). Keep `materialEntries` in step with `model_materials` in the desktop host;
// `fixtures/protocol/material-names.json` pins both.
type Factor = readonly number[];
const factor = (value: unknown, size: number, fallback: Factor): Factor =>
    Array.isArray(value) && value.length >= size && value.slice(0, size).every(x => typeof x === 'number' && Number.isFinite(x)) ? value as number[] : fallback;
const numberOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
// The fourth item of a color factor, else 1.
const alpha = (value: unknown) => numberOr(Array.isArray(value) ? value[3] : undefined, 1);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
// The three.js `ColorManagement` linear-sRGB to sRGB transfer and the `Color.getHex` rounding (three 0.187.0).
const channel = (linear: number) => {
    const srgb = linear < 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 0.41666) - 0.055;
    const byte = Math.round(clamp(srgb * 255, 0, 255));
    return Number.isFinite(byte) ? byte : 0;
};
/** The lowercase `#rrggbb` of a linear color factor. */
export const linearHex = (rgb: Factor) => '#' + rgb.slice(0, 3).map(c => channel(c).toString(16).padStart(2, '0')).join('');
// three-vrm v0compat `gammaEOTF`.
const gamma = (v: number) => Math.pow(v, 2.2);
const OUTLINE_MODES = ['none', 'worldCoordinates', 'screenCoordinates'];

type Values = { base: Factor; opacity: number; blend: boolean; emission: Factor; strength: number; shade: Factor; rim: Factor; outlineMode: unknown; outlineWidth: number; outlineColor: Factor };
const black: Factor = [0, 0, 0];
// three-vrm v0compat `_parseV0MToonProperties` and `_parseV0UnlitProperties`: the values that it writes in place of the glTF material.
const v0Values = (props: Json, shader: string): Values => {
    const vectors = object(props.vectorProperties) ?? {}, floats = object(props.floatProperties) ?? {}, keywords = object(props.keywordMap) ?? {};
    const color = (key: string, fallback: Factor) => factor(vectors[key], 3, fallback).slice(0, 3).map(gamma);
    if (shader !== 'VRM/MToon') {
        // The Unlit form applies the gamma to the alpha too.
        const blend = shader === 'VRM/UnlitTransparent' || shader === 'VRM/UnlitTransparentZWrite';
        return { base: color('_Color', [1, 1, 1]), opacity: gamma(alpha(vectors._Color)), blend, emission: black, strength: 1, shade: black, rim: black, outlineMode: 'none', outlineWidth: 0, outlineColor: black };
    }
    const mode = floats._OutlineWidthMode ?? 0;
    return {
        base: color('_Color', [1, 1, 1]),
        // The MToon form keeps the alpha linear.
        opacity: alpha(vectors._Color),
        blend: Boolean(keywords._ALPHABLEND_ON),
        emission: color('_EmissionColor', black),
        strength: 1,
        shade: color('_ShadeColor', [0.97, 0.81, 0.86]),
        rim: color('_RimColor', black),
        outlineMode: typeof mode === 'number' ? OUTLINE_MODES[mode] : undefined,
        outlineWidth: 0.01 * numberOr(floats._OutlineWidth, 0),
        outlineColor: color('_OutlineColor', black),
    };
};
// A glTF or VRM 1 material, with the GLTFLoader and three-vrm MToon defaults.
const gltfValues = (material: Json): Values => {
    const base = object(material.pbrMetallicRoughness)?.baseColorFactor;
    const extensions = object(material.extensions) ?? {};
    const mtoon = object(extensions.VRMC_materials_mtoon) ?? {};
    const hdr = object(extensions.VRMC_materials_hdr_emissiveMultiplier)?.emissiveMultiplier;
    const strength = object(extensions.KHR_materials_emissive_strength)?.emissiveStrength;
    return {
        base: factor(base, 3, [1, 1, 1]),
        opacity: alpha(base),
        blend: material.alphaMode === 'BLEND',
        emission: factor(material.emissiveFactor, 3, black),
        // The three-vrm multiplier plugin runs after the GLTFLoader strength plugin, so the multiplier wins.
        strength: numberOr(hdr, numberOr(strength, 1)),
        shade: factor(mtoon.shadeColorFactor, 3, black),
        rim: factor(mtoon.parametricRimColorFactor, 3, black),
        outlineMode: mtoon.outlineWidthMode ?? 'none',
        outlineWidth: numberOr(mtoon.outlineWidthFactor, 0),
        outlineColor: factor(mtoon.outlineColorFactor, 3, black),
    };
};

/** R13: the materials of a glTF document in material order (the first 256), each with a unique name and its model values. */
export function materialEntries(json: unknown): AssetMaterial[] {
    const root = object(json) ?? {};
    const materials = array(root.materials);
    const v0 = array(object(object(root.extensions)?.VRM)?.materialProperties);
    const taken = new Set<string>();
    return materialReport(json).materials.slice(0, MAX_MATERIALS).map(({ index, profile }): AssetMaterial => {
        const material = object(materials[index]) ?? {};
        const props = object(v0[index]);
        const shader = typeof props?.shader === 'string' ? props.shader : '';
        const values = props && (shader === 'VRM/MToon' || shader.startsWith('VRM/Unlit')) ? v0Values(props, shader) : gltfValues(material);
        // three-vrm `_shouldGenerateOutline`.
        const outline = profile === 'mtoon' && typeof values.outlineMode === 'string' && values.outlineMode !== 'none' && values.outlineWidth > 0;
        const shape: MaterialShape = { profile, blend: values.blend, outline };
        const all: Record<MaterialParameter, string | number> = {
            baseColor: linearHex(values.base),
            opacity: clamp(values.opacity, 0, 1),
            emissionColor: linearHex(values.emission),
            emissionStrength: clamp(values.strength, 0, 100),
            shadeColor: linearHex(values.shade),
            rimColor: linearHex(values.rim),
            outlineColor: linearHex(values.outlineColor),
            outlineWidth: clamp(values.outlineWidth, 0, 0.05),
        };
        const model = Object.fromEntries(appliedParameters(shape).map(spec => [spec.key, all[spec.key]]));
        return { index, name: uniqueName(material.name, `Material ${index}`, MAX_MATERIAL_NAME, taken), ...shape, model };
    });
}
