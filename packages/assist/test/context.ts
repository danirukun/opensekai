import type { AssetSummary, LightSettings, SceneEntity, SceneView } from '@opensekai/contracts';
import smoke from '../../../fixtures/protocol/valid-scene.json';
import { assignRefs, emptyRefs, type CompileContext } from '../src';

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
