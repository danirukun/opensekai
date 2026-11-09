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
