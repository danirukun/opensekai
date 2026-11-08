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

 it('puts assets that the scene uses first', () => {
  const assets = [asset('a', 'Alpha', ['palm']), asset('fixture_glb_1', 'Zed')];
  const lines = assetLines(sceneSummary({ ...base, scene, assets, prompt: 'palm' }).text);
  expect(lines[0]).toContain('Zed');
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

describe('lookUp', () => {
 const graph = { schemaVersion: 1, id: 'g1', name: 'Show', enabled: true, connections: [], variables: [],
  nodes: [{ id: 'n1', type: 'event.start' }, { id: 'n2', type: 'action.wait' }, { id: 'n3', type: 'action.wait' }] } as unknown as BlueprintGraph;

 it('gives a light its type, color, and intensity', () => {
  const { refs } = sceneSummary({ ...base, scene: withLight, assets: [] });
  const r = lookUp({ ...base, scene: withLight, assets: [], blueprints: [graph], refs, ref: refs.entities.key! });
  expect(r.ok && r.data).toContain('point');
  expect(r.ok && r.data).toContain('#ff8800');
  expect(r.ok && r.data).toContain('2.5');
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
