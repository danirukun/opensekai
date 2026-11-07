import {describe, expect, it} from 'vitest';
import {materialReport, materialWarning} from '../src/materials';

const one = (json: unknown) => materialReport(json).materials[0];

describe('materialReport', () => {
    it('reads the profile of VRM 1.0, VRM 0.x, unlit, and PBR materials', () => {
        expect(one({materials: [{name: 'Face', extensions: {VRMC_materials_mtoon: {}, KHR_materials_unlit: {}}}]})).toEqual({index: 0, name: 'Face', profile: 'mtoon', unsupported: []});
        const v0 = materialReport({
            materials: [{name: 'Hair'}, {name: 'A'}, {name: 'B'}, {name: 'C'}, {name: 'D'}, {name: 'E'}],
            extensions: {VRM: {materialProperties: [{shader: 'VRM/MToon'}, {shader: 'VRM/UnlitCutout'}, {shader: 'VRM/UnlitFoo'}, {shader: 'Standard'}, {shader: 'VRM_USE_GLTFSHADER'}, {}]}},
        }).materials;
        expect(v0.map(x => [x.profile, x.unsupported])).toEqual([
            ['mtoon', []], ['unlit', []], ['unlit', []], ['pbr', ['shader:Standard']], ['pbr', []], ['pbr', []],
        ]);
        expect(one({materials: [{extensions: {KHR_materials_unlit: {}}}]}).profile).toBe('unlit');
    });
    it('lists only the extensions that the loader or MToon does not read', () => {
        expect(one({materials: [{extensions: {KHR_materials_specular: {}}}]}).unsupported).toEqual([]);
        expect(one({materials: [{extensions: {VRMC_materials_mtoon: {}, KHR_materials_clearcoat: {}}}]}).unsupported).toEqual(['KHR_materials_clearcoat']);
        expect(one({materials: [{extensions: {KHR_materials_pbrSpecularGlossiness: {}, KHR_materials_diffuse_transmission: {}}}]}).unsupported)
            .toEqual(['KHR_materials_diffuse_transmission', 'KHR_materials_pbrSpecularGlossiness']);
    });
    it('reports root KHR_materials_variants on the asset', () => {
        expect(materialReport({extensionsUsed: ['KHR_materials_variants', 'KHR_texture_transform'], materials: []})).toEqual({materials: [], asset: ['KHR_materials_variants']});
    });
    it('lists a Basis texture only when it has no core source', () => {
        const textures = [{extensions: {KHR_texture_basisu: {source: 0}}}, {extensions: {KHR_texture_basisu: {source: 0}}}, {source: 1, extensions: {KHR_texture_basisu: {source: 0}}}];
        const report = materialReport({textures, materials: [
            {pbrMetallicRoughness: {baseColorTexture: {index: 0}}},
            {extensions: {KHR_materials_clearcoat: {clearcoatTexture: {index: 1}}}},
            {pbrMetallicRoughness: {baseColorTexture: {index: 2}}},
        ]});
        expect(report.materials.map(x => x.unsupported)).toEqual([['KHR_texture_basisu'], ['KHR_texture_basisu'], []]);
    });
    it('names a material by index and cuts long names and keys to 64 units', () => {
        expect(one({materials: [{name: '  '}]}).name).toBe('Material 0');
        expect(one({materials: [{}]}).name).toBe('Material 0');
        const long = 'x'.repeat(200);
        const entry = one({materials: [{name: long, extensions: {[long]: {}}}]});
        expect(entry.name).toHaveLength(64);
        expect(entry.unsupported[0]).toHaveLength(64);
        expect(one({materials: [{name: 'a'.repeat(63) + '😀'}]}).name).toBe('a'.repeat(63));
    });
    it('does not throw on a malformed shape', () => {
        expect(materialReport({materials: 'bad'})).toEqual({materials: [], asset: []});
        expect(materialReport(null)).toEqual({materials: [], asset: []});
        expect(materialReport({materials: [null, 3, {extensions: []}], extensions: {VRM: {materialProperties: 'x'}}, textures: {}}).materials.map(x => x.profile)).toEqual(['pbr', 'pbr', 'pbr']);
        expect(one({materials: [{name: 4, pbrMetallicRoughness: {baseColorTexture: {index: 9}}}]})).toEqual({index: 0, name: 'Material 0', profile: 'pbr', unsupported: []});
    });
});

describe('materialWarning', () => {
    const flagged = (n: number) => ({materials: Array.from({length: n}, (_, index) => ({index, name: `M${index}`, profile: 'pbr' as const, unsupported: ['KHR_x', 'KHR_y']})), asset: []});
    it('gives no warning without an unsupported feature', () => {
        expect(materialWarning({materials: [{index: 0, name: 'A', profile: 'pbr', unsupported: []}], asset: []})).toBeNull();
    });
    it('lists at most 16 materials, then the rest count and the asset features', () => {
        expect(materialWarning(flagged(1))).toBe('Unsupported material features: M0 (KHR_x, KHR_y)');
        const text = materialWarning({...flagged(20), asset: ['KHR_materials_variants']})!;
        expect(text.split('; ')).toHaveLength(18);
        expect(text).toContain('M15 (KHR_x, KHR_y); and 4 more; asset (KHR_materials_variants)');
        expect(text).not.toContain('M16');
    });
    it('lists at most 8 features of one material', () => {
        const unsupported = Array.from({length: 10}, (_, i) => `KHR_${i}`);
        expect(materialWarning({materials: [{index: 0, name: 'A', profile: 'pbr', unsupported}], asset: []}))
            .toBe('Unsupported material features: A (KHR_0, KHR_1, KHR_2, KHR_3, KHR_4, KHR_5, KHR_6, KHR_7, and 2 more)');
    });
});
