import type { AssetSummary, BlueprintGraph, Id, Reply, SceneEntity, SceneView } from '@opensekai/contracts';
import { assignRefs, refOf, resolveRef, type RefTable } from './refs';

export const SUMMARY_ASSETS = 12;

type Input = { scene: SceneView; blueprints: BlueprintGraph[]; assets: AssetSummary[]; refs: RefTable; selection: Id | null };

const entityRefOrNone = (refs: RefTable, id: Id | null) => id !== null && Object.hasOwn(refs.entities, id) ? refOf(refs, 'entity', id) : 'none';

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const score = (a: AssetSummary, prompt: string) =>
 [...(a.catalog?.tags ?? []).map(t => t.trim().toLowerCase()), ...words(a.name), ...words(a.catalog?.description ?? '')]
  .filter(w => w !== '' && prompt.includes(w)).length;

const rankAssets = (assets: AssetSummary[], scene: SceneView, prompt: string): AssetSummary[] => {
 // Only the assets of avatars and environments come first (R9); a prop mesh asset ranks by the prompt.
 const used = new Set(scene.entities.flatMap(e => e.kind === 'avatar' || e.kind === 'environment' ? [e.assetId] : []));
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
  `scene ${scene.sceneId}`,
  ...scene.entities.map(e => `${refOf(refs, 'entity', e.id)} ${e.name} · ${e.kind}`),
  `output ${entityRefOrNone(refs, scene.outputs[0]?.cameraId ?? null)}`,
  ...(selection !== null && Object.hasOwn(refs.entities, selection) ? [`selection ${refOf(refs, 'entity', selection)}`] : []),
  ...blueprints.map(b => `${refOf(refs, 'blueprint', b.id)} ${b.name} · blueprint`),
  ...listed.map(a => `${refOf(refs, 'asset', a.id)} ${a.name} · ${a.kind}${a.catalog?.tags.length ? ` · ${a.catalog.tags.join(', ')}` : ''}`),
 ];
 return { text: lines.join('\n'), refs };
};

const notFound = (ref: string): Reply<never> => ({ ok: false, error: { code: 'NOT_FOUND', message: `No ${ref} in this scene`, ids: [ref] } });

const countTypes = (g: BlueprintGraph) =>
 Object.entries(g.nodes.reduce<Record<string, number>>((c, n) => ({ ...c, [n.type]: (c[n.type] ?? 0) + 1 }), {}))
  .sort(([a], [b]) => a.localeCompare(b)).map(([t, n]) => `${t} ${n}`).join(', ');

// `+ 0` turns -0 into 0.
const round = (v: number) => Math.round(v * 100) / 100 + 0;

const kindValues = (e: SceneEntity, assets: AssetSummary[]): string[] => {
 switch (e.kind) {
  case 'light': return [e.light.type, `color ${e.light.color}`, `intensity ${e.light.intensity}`, `shadow ${e.light.shadow.enabled ? 'on' : 'off'}`];
  case 'camera': return [`fov ${round(e.lens.fovDegrees)}`];
  case 'environment': return [`model ${e.assetId === null ? 'none' : assets.find(a => a.id === e.assetId)?.name ?? 'unknown'}`];
  default: return [];
 }
};

const describeEntity = (e: SceneEntity, assets: AssetSummary[]): string =>
 [e.name, e.kind, e.visible ? 'visible' : 'hidden', `at ${e.transform.position.map(round).join(', ')}`, ...kindValues(e, assets)].join(' · ');

const describeAsset = (a: AssetSummary): string => [
 a.name, a.kind, a.catalog?.description, a.catalog?.tags.join(', '),
 a.credits && [[a.credits.title, a.credits.author && `by ${a.credits.author}`].filter(Boolean).join(' '), a.credits.license, a.credits.sourceUrl].filter(Boolean).join(', '),
].filter(Boolean).join(' · ');

export const lookUp = (input: Input & { ref: string }): Reply<string> => {
 const hit = resolveRef(input.refs, input.ref);
 if (!hit) return notFound(input.ref);
 const text = hit.kind === 'entity' ? (e => e && describeEntity(e, input.assets))(input.scene.entities.find(e => e.id === hit.id))
  : hit.kind === 'blueprint' ? (g => g && `${g.name} · ${g.enabled ? 'enabled' : 'disabled'} · nodes: ${countTypes(g)}`)(input.blueprints.find(b => b.id === hit.id))
  : (a => a && describeAsset(a))(input.assets.find(x => x.id === hit.id));
 return text ? { ok: true, data: text } : notFound(input.ref);
};
