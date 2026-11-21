import { expect, it } from 'vitest';
import { makeSmokeScene, type AssetMaterial, type AssetRecord } from '@opensekai/contracts';
import { fitMaterialSettings, materialOptions, materialParameterOptions, propOptions } from '../src/blueprints/fields';

// B38 R23: the Material and Property choices of the Set and Reset Material Property nodes.
const scene = makeSmokeScene();
const material = (index: number, name: string, extra: Partial<AssetMaterial>): AssetMaterial => ({ index, name, profile: 'pbr', blend: false, outline: false, model: {}, ...extra });
const base = { sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1 as const, expressions: [] };
const assets: AssetRecord[] = [
 { ...base, id: 'fixture_vrm_1', format: 'vrm', name: 'Rem', materials: [material(0, 'Skin', { profile: 'mtoon', outline: true }), material(1, 'Hair', { blend: true }), material(2, 'Eye', { profile: 'unlit' })] },
 { ...base, id: 'fixture_glb_1', format: 'glb', name: 'Room', materials: [material(0, 'Floor', {})] },
];

it('lists the record materials in file order, and only the props with an asset model', () => {
 expect(materialOptions(scene, assets, 'performer').map(option => option.value)).toEqual(['Skin', 'Hair', 'Eye']);
 expect(materialOptions(scene, assets, 'reference')).toEqual([{ value: 'Floor', label: 'Floor' }]);
 expect(materialOptions(scene, assets, 'marker')).toEqual([]);
 expect(propOptions(scene)).toEqual([{ value: 'reference', label: expect.any(String) }]);
});

it('lists the parameters that apply to the material, in R14 order', () => {
 const labels = (name: string) => materialParameterOptions(scene, assets, 'performer', name).map(option => option.label);
 expect(labels('Skin')).toEqual(['Base Color', 'Emission Color', 'Emission Strength', 'Shade Color', 'Rim Color', 'Outline Color', 'Outline Width']);
 expect(labels('Hair')).toEqual(['Base Color', 'Opacity', 'Emission Color', 'Emission Strength']);
 expect(labels('Eye')).toEqual(['Base Color']);
 expect(labels('Gone')).toEqual([]);
});

it('takes the first parameter that applies on a material change, and keeps one that applies', () => {
 const settings = { entityId: 'performer', material: 'Eye', parameter: 'shadeColor' as const };
 expect(fitMaterialSettings(settings, scene, assets)).toEqual({ ...settings, parameter: 'baseColor' });
 expect(fitMaterialSettings({ ...settings, material: 'Skin' }, scene, assets)).toEqual({ ...settings, material: 'Skin' });
 // A missing material keeps the saved parameter.
 expect(fitMaterialSettings({ ...settings, material: 'Gone' }, scene, assets)).toEqual({ ...settings, material: 'Gone' });
});
