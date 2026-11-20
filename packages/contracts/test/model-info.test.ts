import {describe, expect, it} from 'vitest';
import {modelInfo} from '../src/model-info';

const vrm1 = {
    asset: {generator: 'UniVRM-0.131.4', version: '2.0'},
    extensionsUsed: ['VRMC_vrm', 'VRMC_springBone', 'MOCHIYA_materials_liltoon', 'KHR_texture_transform'],
    extensionsRequired: ['KHR_texture_transform'],
    nodes: [{}, {}, {}],
    meshes: [{primitives: [{}, {}]}, {primitives: [{}]}],
    skins: [{joints: [0, 1]}, {joints: [1, 2]}],
    images: [{name: 'Body', mimeType: 'image/png', bufferView: 0}],
    bufferViews: [{byteLength: 4096}],
    textures: [{source: 0}],
    materials: [{
        name: 'Body',
        alphaMode: 'MASK',
        alphaCutoff: 0.5,
        doubleSided: true,
        pbrMetallicRoughness: {baseColorFactor: [1, 0.5, 0.25, 1], baseColorTexture: {index: 0}},
        extensions: {
            MOCHIYA_materials_liltoon: {specVersion: '1.0', lilToonVersion: '2.3.2', shaderVariant: 'lilToonCutout', renderQueue: 2450,
                properties: {_Cutoff: 0.5, _Color: [1, 1, 1, 1]}, textures: {_MainTex: {index: 0, texCoord: 0}}},
        },
    }],
    extensions: {
        VRMC_vrm: {specVersion: '1.0', meta: {name: 'RORO', authors: ['a', 'b'], licenseUrl: 'https://example.com', allowRedistribution: false, thumbnailImage: 0, references: [], nested: {x: 1}},
            humanoid: {humanBones: {hips: {node: 0}, spine: {node: 1}}}, expressions: {preset: {happy: {}, blink: {}}, custom: {wink: {}}}},
        VRMC_springBone: {springs: [{}, {}], colliders: [{}]},
    },
    animations: [{}],
};

describe('modelInfo', () => {
    it('reads the file, extensions, meta, and counts of a VRM 1 file', () => {
        const info = modelInfo(vrm1);
        expect(info.format).toEqual({vrm: '1.0', generator: 'UniVRM-0.131.4', gltf: '2.0'});
        expect(info.extensions).toEqual([
            {name: 'VRMC_vrm', required: false}, {name: 'VRMC_springBone', required: false},
            {name: 'MOCHIYA_materials_liltoon', required: false}, {name: 'KHR_texture_transform', required: true},
        ]);
        expect(info.meta).toEqual([
            {name: 'name', value: 'RORO'}, {name: 'authors', value: 'a, b'}, {name: 'licenseUrl', value: 'https://example.com'},
            {name: 'allowRedistribution', value: 'false'}, {name: 'thumbnailImage', value: '0'}, {name: 'references', value: ''},
        ]);
        expect(Object.fromEntries(info.counts.map(c => [c.key, c.value]))).toEqual({
            nodes: 3, meshes: 2, primitives: 3, materials: 1, textures: 1, images: 1, skins: 2, joints: 3,
            humanoidBones: 2, expressions: 3, springs: 2, colliders: 1, constraints: 0, animations: 1,
        });
    });

    it('reads a lilToon material with its properties and texture slots', () => {
        const [material] = modelInfo(vrm1).materials;
        expect(material).toMatchObject({
            index: 0, name: 'Body', profile: 'liltoon', unsupported: [], extensions: ['MOCHIYA_materials_liltoon'],
            alphaMode: 'MASK', cull: 'Off',
            lilToon: {specVersion: '1.0', lilToonVersion: '2.3.2', shaderVariant: 'lilToonCutout', renderQueue: 2450},
        });
        const rows = Object.fromEntries(material!.properties.map(row => [row.name, row.value]));
        expect(rows).toMatchObject({
            alphaCutoff: '0.5', 'pbrMetallicRoughness.baseColorFactor': '1, 0.5, 0.25, 1', _Cutoff: '0.5', _Color: '1, 1, 1, 1',
        });
        expect(Object.keys(rows).some(name => name.includes('properties.') || name.includes('textures.'))).toBe(false);
        expect(material!.textures).toEqual([
            {slot: 'baseColorTexture', image: 0, name: 'Body', mimeType: 'image/png', bytes: 4096},
            {slot: '_MainTex', image: 0, name: 'Body', mimeType: 'image/png', bytes: 4096},
        ]);
    });

    it('reads a VRM 0 file and its material properties', () => {
        const info = modelInfo({
            asset: {version: '2.0'},
            extensionsUsed: ['VRM'],
            materials: [{name: 'Hair'}],
            extensions: {VRM: {
                meta: {title: 'Old', author: 'c', licenseName: 'CC0'},
                humanoid: {humanBones: [{bone: 'hips', node: 0}]},
                blendShapeMaster: {blendShapeGroups: [{}, {}]},
                secondaryAnimation: {boneGroups: [{}], colliderGroups: [{colliders: [{}, {}]}]},
                materialProperties: [{shader: 'VRM/MToon', floatProperties: {_Cutoff: 0.5}, vectorProperties: {_Color: [1, 1, 1, 1]}, keywordMap: {_ALPHATEST_ON: true}, tagMap: {RenderType: 'TransparentCutout'}, textureProperties: {_MainTex: 0}}],
            }},
        });
        expect(info.format.vrm).toBe('0.x');
        expect(info.format.generator).toBeNull();
        expect(info.meta).toEqual([{name: 'title', value: 'Old'}, {name: 'author', value: 'c'}, {name: 'licenseName', value: 'CC0'}]);
        const counts = Object.fromEntries(info.counts.map(c => [c.key, c.value]));
        expect(counts).toMatchObject({humanoidBones: 1, expressions: 2, springs: 1, colliders: 2});
        const [material] = info.materials;
        expect(material!.profile).toBe('mtoon');
        expect(material!.cull).toBe('Back');
        expect(material!.alphaMode).toBe('OPAQUE');
        expect(material!.lilToon).toBeNull();
        expect(material!.properties).toEqual(expect.arrayContaining([
            {name: 'shader', value: 'VRM/MToon'}, {name: '_Cutoff', value: '0.5'}, {name: '_Color', value: '1, 1, 1, 1'},
            {name: '_ALPHATEST_ON', value: 'true'}, {name: 'RenderType', value: 'TransparentCutout'},
        ]));
        expect(material!.textures).toEqual([{slot: '_MainTex', image: null, name: '', mimeType: '', bytes: null}]);
    });

    it('bounds the lists and the strings', () => {
        const properties = Object.fromEntries(Array.from({length: 2000}, (_, i) => [`_P${i}`, i]));
        const info = modelInfo({
            asset: {generator: 'x'.repeat(1000)},
            extensionsUsed: Array.from({length: 100}, (_, i) => `EXT_${i}`),
            materials: Array.from({length: 300}, () => ({name: 'n'.repeat(200), extensions: {MOCHIYA_materials_liltoon: {properties}}})),
            extensions: {VRMC_vrm: {meta: Object.fromEntries(Array.from({length: 50}, (_, i) => [`k${i}`, 'v']))}},
        });
        expect(info.format.generator).toHaveLength(256);
        expect(info.extensions).toHaveLength(64);
        expect(info.meta).toHaveLength(32);
        expect(info.materials).toHaveLength(256);
        expect(info.materials[0]!.name).toHaveLength(64);
        expect(info.materials[0]!.properties).toHaveLength(1024);
        const transform = modelInfo({materials: [{pbrMetallicRoughness: {baseColorTexture: {index: 0, extensions: {KHR_texture_transform: {offset: [0, 0], scale: [1, 1]}}}}}]});
        expect(transform.materials[0]!.properties.map(row => row.name)).toContain('pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform.scale');
        expect(modelInfo(null).materials).toEqual([]);
        expect(modelInfo('text').format).toEqual({vrm: null, generator: null, gltf: null});
    });
});
