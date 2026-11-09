import { describe, expect, it } from 'vitest';
import type { AssetSummary, BlueprintGraph, SceneView } from '@opensekai/contracts';
import smokeScene from '../../../fixtures/protocol/valid-scene.json';
import { emptyRefs, lookUp, sceneSummary, SUMMARY_ASSETS } from '../src';

const scene = smokeScene as unknown as SceneView;
const light = {
 id: 'key', name: 'key', visible: true, kind: 'light',
 transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
 light: { type: 'point', color: '#ff8800', intensity: 2.5, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: 0, normalBias: 0 } },
} as unknown as SceneView['entities'][number];
const withLight: SceneView = { ...scene, entities: [...scene.entities, light] };
const asset = (id: string, name: string, tags: string[] = [], description: string | null = null): AssetSummary =>
 ({ id, kind: 'scene', name, catalog: { description, tags } });
const base = { blueprints: [] as BlueprintGraph[], refs: emptyRefs(), selection: null };
const assetLines = (text: string) => text.split('\n').filter(l => /^@a\d+ /.test(l));

describe('sceneSummary', () => {
 it('summarizes without transforms or light values', () => {
  const { text } = sceneSummary({ ...base, scene: withLight, assets: [], selection: 'performer' });
  expect(text).toMatch(/^@e\d+ .+ · avatar$/m);
  expect(text).toMatch(/^selection @e\d+$/m);
  expect(text).not.toMatch(/position|intensity|#[0-9a-f]{6}/);
 });

 it('returns a table that holds every listed reference', () => {
  const { text, refs } = sceneSummary({ ...base, scene, assets: [asset('a1', 'Beach')] });
  expect(Object.keys(refs.entities)).toHaveLength(scene.entities.length);
  expect(refs.assets).toEqual({ a1: '@a1' });
  expect(text).not.toMatch(/^selection/m);
 });

 it('lists at most 12 assets ranked by the prompt', () => {
  const assets = Array.from({ length: 20 }, (_, i) => asset(`s${i}`, `Set ${String(i).padStart(2, '0')}`));
  assets[17] = asset('palm', 'Island', ['palm', 'tree']);
  const lines = assetLines(sceneSummary({ ...base, scene, assets, prompt: 'beach palm' }).text);
  expect(SUMMARY_ASSETS).toBe(12);
  expect(lines).toHaveLength(12);
  expect(lines[0]).toContain('Island');
 });

 it('puts assets that an avatar or environment in the scene uses first, but not a prop mesh asset', () => {
  const assets = [asset('a', 'Alpha', ['palm']), asset('fixture_vrm_1', 'Zed'), asset('fixture_glb_1', 'Prop')];
  const lines = assetLines(sceneSummary({ ...base, scene, assets, prompt: 'palm' }).text);
  expect(lines.map(l => l.split(' · ')[0]!.replace(/^@a\d+ /, ''))).toEqual(['Zed', 'Alpha', 'Prop']);
 });

 it('ranks assets for a Japanese prompt', () => {
  const assets = [asset('a', 'Aaa', ['屋外']), asset('b', 'Zzz', ['ステージ'])];
  const lines = assetLines(sceneSummary({ ...base, scene, assets, prompt: 'ステージを紫に' }).text);
  expect(lines[0]).toContain('Zzz');
 });

 it('does not let an empty tag or word match every prompt', () => {
  const assets = [asset('a', 'Aaa', ['']), asset('b', 'Zzz', ['palm'], '  ')];
  const lines = assetLines(sceneSummary({ ...base, scene, assets, prompt: 'palm' }).text);
  expect(lines[0]).toContain('Zzz');
 });

 it('ranks by name alone when an asset has no catalog', () => {
  const assets: AssetSummary[] = [{ id: 'a', kind: 'scene', name: 'Zebra' }, { id: 'b', kind: 'scene', name: 'Palm Beach' }];
  const lines = assetLines(sceneSummary({ ...base, scene, assets, prompt: 'palm' }).text);
  expect(lines[0]).toContain('Palm Beach');
 });
});

describe('sceneSummary header', () => {
 it('names the scene and the output camera', () => {
  const { text, refs } = sceneSummary({ ...base, scene, assets: [] });
  expect(text).toMatch(/^scene scene_smoke$/m);
  expect(text).toMatch(new RegExp(`^output ${refs.entities.camera_wide}$`, 'm'));
 });

 it('gives none when the output camera is not an entity', () => {
  const { text } = sceneSummary({ ...base, scene: { ...scene, outputs: [] }, assets: [] });
  expect(text).toMatch(/^output none$/m);
 });
});

describe('lookUp', () => {
 const graph = { schemaVersion: 1, id: 'g1', name: 'Show', enabled: true, connections: [], variables: [],
  nodes: [{ id: 'n1', type: 'event.start' }, { id: 'n2', type: 'action.wait' }, { id: 'n3', type: 'action.wait' }] } as unknown as BlueprintGraph;

 it('gives a light its type, color, and intensity', () => {
  const { refs } = sceneSummary({ ...base, scene: withLight, assets: [] });
  const r = lookUp({ ...base, scene: withLight, assets: [], blueprints: [graph], refs, ref: refs.entities.key! });
  expect(r.ok && r.data).toContain('point');
  expect(r.ok && r.data).toContain('#ff8800');
  expect(r.ok && r.data).toContain('2.5');
  expect(r.ok && r.data).toContain('shadow off');
  expect(r.ok && r.data).toContain('1, 2, 3');
 });

 it('gives a camera its rounded position and field of view', () => {
  const cam: SceneView = { ...scene, entities: scene.entities.map(e => e.kind === 'camera' ? { ...e, transform: { ...e.transform, position: [0.123456, 1.5, -2.004] }, lens: { ...e.lens, fovDegrees: 32 } } : e) };
  const { refs } = sceneSummary({ ...base, scene: cam, assets: [] });
  const r = lookUp({ ...base, scene: cam, assets: [], refs, ref: refs.entities.camera_wide! });
  expect(r.ok && r.data).toContain('0.12, 1.5, -2');
  expect(r.ok && r.data).toContain('fov 32');
 });

 it('gives an environment its asset name and an asset its credits', () => {
  const room: AssetSummary = { id: 'room', kind: 'scene', name: 'Concert hall', credits: { title: 'Hall', author: 'Ada', license: 'CC-BY-4.0', sourceUrl: 'https://example.com/hall' } };
  const env = { id: 'env', name: 'env', visible: true, kind: 'environment', assetId: 'room', transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } } as unknown as SceneView['entities'][number];
  const withEnv: SceneView = { ...scene, entities: [...scene.entities, env] };
  const { refs } = sceneSummary({ ...base, scene: withEnv, assets: [room] });
  const e = lookUp({ ...base, scene: withEnv, assets: [room], refs, ref: refs.entities.env! });
  expect(e.ok && e.data).toContain('Concert hall');
  const a = lookUp({ ...base, scene: withEnv, assets: [room], refs, ref: refs.assets.room! });
  for (const part of ['Hall', 'Ada', 'CC-BY-4.0', 'https://example.com/hall']) expect(a.ok && a.data).toContain(part);
 });

 it('omits a null credit title or author', () => {
  const credited = (title: string | null, author: string | null): AssetSummary => ({ id: 'room', kind: 'scene', name: 'Hall', credits: { title, author, license: 'CC0', sourceUrl: null } });
  const text = (title: string | null, author: string | null) => {
   const assets = [credited(title, author)], { refs } = sceneSummary({ ...base, scene, assets });
   const r = lookUp({ ...base, scene, assets, refs, ref: refs.assets.room! });
   return r.ok ? r.data : '';
  };
  expect(text(null, 'Ada')).toBe('Hall · scene · by Ada, CC0');
  expect(text('Hall', null)).toBe('Hall · scene · Hall, CC0');
  expect(text(null, null)).toBe('Hall · scene · CC0');
  for (const t of [text(null, 'Ada'), text('Hall', null), text(null, null)]) expect(t).not.toContain('null');
 });

 it('gives a Blueprint its node type counts', () => {
  const { refs } = sceneSummary({ ...base, scene, assets: [], blueprints: [graph] });
  const r = lookUp({ ...base, scene, assets: [], blueprints: [graph], refs, ref: refs.blueprints.g1! });
  expect(r.ok && r.data).toContain('action.wait 2');
  expect(r.ok && r.data).toContain('event.start 1');
 });

 it('fails for an unknown reference', () => {
  const r = lookUp({ ...base, scene, assets: [], ref: '@e99' });
  expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['@e99'] } });
 });
});
