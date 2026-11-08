import type { AssetSummary, BlueprintGraph, Id, Reply, SceneEntity, SceneView } from '@opensekai/contracts';
import { assignRefs, refOf, resolveRef, type RefTable } from './refs';

export const SUMMARY_ASSETS = 12;

type Input = { scene: SceneView; blueprints: BlueprintGraph[]; assets: AssetSummary[]; refs: RefTable; selection: Id | null };

const entityAssetId = (e: SceneEntity): Id | null =>
 e.kind === 'avatar' || e.kind === 'environment' ? e.assetId : e.kind === 'mesh' && e.source.kind === 'asset' ? e.source.assetId : null;

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const score = (a: AssetSummary, prompt: string) =>
 [...(a.catalog?.tags ?? []).map(t => t.trim().toLowerCase()), ...words(a.name), ...words(a.catalog?.description ?? '')]
  .filter(w => w !== '' && prompt.includes(w)).length;

const rankAssets = (assets: AssetSummary[], scene: SceneView, prompt: string): AssetSummary[] => {
 const used = new Set(scene.entities.map(entityAssetId));
 const p = prompt.toLowerCase();
 return assets
  .map(a => ({ a, used: used.has(a.id), s: score(a, p) }))
  .sort((x, y) => Number(y.used) - Number(x.used) || y.s - x.s || x.a.name.localeCompare(y.a.name))
  .slice(0, SUMMARY_ASSETS)
  .map(x => x.a);
};

export const sceneSummary = (input: Input & { prompt?: string }): { text: string; refs: RefTable } => {
 const { scene, blueprints, selection } = input;
 const listed = rankAssets(input.assets, scene, input.prompt ?? '');
 const refs = assignRefs(input.refs, { entities: scene.entities.map(e => e.id), blueprints: blueprints.map(b => b.id), assets: listed.map(a => a.id) });
 const lines = [
  ...scene.entities.map(e => `${refOf(refs, 'entity', e.id)} ${e.name} · ${e.kind}`),
  ...(selection !== null && selection in refs.entities ? [`selection ${refOf(refs, 'entity', selection)}`] : []),
  ...blueprints.map(b => `${refOf(refs, 'blueprint', b.id)} ${b.name} · blueprint`),
  ...listed.map(a => `${refOf(refs, 'asset', a.id)} ${a.name} · ${a.kind}${a.catalog?.tags.length ? ` · ${a.catalog.tags.join(', ')}` : ''}`),
 ];
 return { text: lines.join('\n'), refs };
};

const notFound = (ref: string): Reply<never> => ({ ok: false, error: { code: 'NOT_FOUND', message: `No ${ref} in this scene`, ids: [ref] } });

const countTypes = (g: BlueprintGraph) =>
 Object.entries(g.nodes.reduce<Record<string, number>>((c, n) => ({ ...c, [n.type]: (c[n.type] ?? 0) + 1 }), {}))
  .sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}`).join(', ');

const describeEntity = (e: SceneEntity): string => {
 const head = `${e.name} · ${e.kind} · ${e.visible ? 'visible' : 'hidden'}`;
 return e.kind === 'light' ? `${head} · ${e.light.type} · color ${e.light.color} · intensity ${e.light.intensity}` : head;
};

export const lookUp = (input: Input & { ref: string }): Reply<string> => {
 const hit = resolveRef(input.refs, input.ref);
 if (!hit) return notFound(input.ref);
 const text = hit.kind === 'entity' ? input.scene.entities.find(e => e.id === hit.id) && describeEntity(input.scene.entities.find(e => e.id === hit.id)!)
  : hit.kind === 'blueprint' ? (g => g && `${g.name} · ${g.enabled ? 'enabled' : 'disabled'} · nodes: ${countTypes(g)}`)(input.blueprints.find(b => b.id === hit.id))
  : (a => a && [a.name, a.kind, a.catalog?.description, a.catalog?.tags.join(', ')].filter(Boolean).join(' · '))(input.assets.find(x => x.id === hit.id));
 return text ? { ok: true, data: text } : notFound(input.ref);
};
