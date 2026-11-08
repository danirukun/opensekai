import { connectionType, type AssetSummary, type BlueprintGraph, type LightSettings, type Reply, type SceneEntity, type SceneView } from '@opensekai/contracts';
import smoke from '../../../fixtures/protocol/valid-scene.json';
import { assignRefs, emptyRefs, type CompileContext, type Proposal } from '../src';

const valid = smoke as unknown as SceneView;
const byId = (id: string) => valid.entities.find(e => e.id === id)!;
const shadowOff: LightSettings['shadow'] = { enabled: false, intensity: 1, soft: true, bias: 0, normalBias: 0 };

export const lightEntity = (id: string, shadow = false): SceneEntity => ({
 id, name: id, visible: true, kind: 'light',
 transform: { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
 light: { type: 'point', color: '#ffffff', intensity: 20, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { ...shadowOff, enabled: shadow } },
});

// Ordered so that @e1 is the avatar, @e2 a camera, and @e3 a light.
export const scene: SceneView = {
 ...valid,
 entities: [byId('performer'), byId('camera_wide'), lightEntity('lamp'), byId('marker'), byId('reference'), byId('camera_close')],
};
export const assets: AssetSummary[] = [
 { id: 'stage', kind: 'scene', name: 'Concert stage' },
 { id: 'crate', kind: 'fixture', name: 'Crate' },
 { id: 'fixture_vrm_1', kind: 'avatar', name: 'Performer' },
];
export const summaryRefs = assignRefs(emptyRefs(), { entities: scene.entities.map(e => e.id), blueprints: [], assets: assets.map(a => a.id) });

export const seqIds = () => {
 const n: Record<string, number> = {};
 return (kind: string) => `chat_${kind}_${(n[kind] = (n[kind] ?? 0) + 1)}`;
};

export const ctx = (over: Partial<CompileContext> = {}): CompileContext =>
 ({ scene, blueprints: [], assets, refs: summaryRefs, selection: null, newId: seqIds(), ...over });

export const graph = (id: string, name = id): BlueprintGraph => ({ schemaVersion: 1, id, name, enabled: true, nodes: [], connections: [], variables: [] });
export const graphs = (n: number): BlueprintGraph[] => Array.from({ length: n }, (_, i) => graph(`user_graph_${i + 1}`));

export const data = <T>(r: Reply<T>): T => { if (!r.ok) throw new Error(r.error.message); return r.data; };
export const graphOf = (p: Proposal, i = 0): BlueprintGraph => {
 const op = p.blueprintOps[i];
 if (op?.kind !== 'createGraph') throw new Error('not a createGraph');
 return op.graph;
};
// The wires whose ports do not exist or do not connect, as `source.port → target.port`; empty for a valid graph.
export const badWires = (g: BlueprintGraph): string[] => g.connections.flatMap(c => {
 const source = g.nodes.find(n => n.id === c.sourceNodeId), target = g.nodes.find(n => n.id === c.targetNodeId);
 return source && target && connectionType(source, c.sourcePort, target, c.targetPort) !== null ? [] : [`${c.sourceNodeId}.${c.sourcePort} → ${c.targetNodeId}.${c.targetPort}`];
});
