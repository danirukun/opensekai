import { applyBlueprintOps, type AssetSummary, type BlueprintGraph, type BlueprintOp, type Id, type PatchOp, type Reply, type SceneEntity, type SceneView } from '@opensekai/contracts';
import type { Intent, IntentTool, Ref } from './intents';
import { assignRefs, resolveRef, type RefTable } from './refs';

export type CompileContext = { scene: SceneView; blueprints: BlueprintGraph[]; assets: AssetSummary[]; refs: RefTable; selection: Id | null; newId: (kind: string) => Id };
export type Note = { code: 'targetDefaulted' | 'shadowSkipped' | 'replacedExisting' | 'countClamped'; ref?: Ref };
export type Proposal = {
 sceneOps: PatchOp[]; blueprintOps: BlueprintOp[]; output: { outputId: Id; cameraId: Id } | null; play: { graphId: Id; nodeId: Id }[];
 touched: { entities: Id[]; blueprints: Id[] }; created: { entities: Id[]; blueprints: Id[] }; notes: Note[]; refs: RefTable;
};
export type WorkingState = { scene: SceneView; blueprints: BlueprintGraph[]; proposal: Proposal };
export type Compiler = (intent: Intent, state: WorkingState, context: CompileContext) => Reply<WorkingState>;

// SceneViewSchema holds at most 64 entities; BlueprintSetSchema at most 8 graphs; BlueprintBatchSchema at most 64 ops.
export const SCENE_ENTITIES = 64;
export const SHOW_BLUEPRINTS = 8;
export const BLUEPRINT_OPS = 64;
// The editor distance between two node columns in a generated graph.
export const COLUMN = 240;

export const invalid = (message: string, ids: string[] = []): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
export const ok = <T>(data: T): Reply<T> => ({ ok: true, data });

type Of<T extends IntentTool> = Extract<Intent, { tool: T }>;
export const only = <T extends IntentTool>(tool: T, f: (intent: Of<T>, state: WorkingState, context: CompileContext) => Reply<WorkingState>): Compiler =>
 (intent, state, context) => intent.tool === tool ? f(intent as Of<T>, state, context) : invalid(`Expected ${tool}`);

export const emptyProposal = (refs: RefTable): Proposal => ({
 sceneOps: [], blueprintOps: [], output: null, play: [], touched: { entities: [], blueprints: [] }, created: { entities: [], blueprints: [] }, notes: [], refs,
});

const editEntity = (scene: SceneView, id: Id, f: (e: SceneEntity) => SceneEntity): SceneView =>
 ({ ...scene, entities: scene.entities.map(e => e.id === id ? f(e) : e) });

// Only the op kinds that the compilers emit; the session applies the real ops.
export const applyToWorking = (scene: SceneView, op: PatchOp): SceneView => {
 switch (op.kind) {
  case 'createEntity': return { ...scene, entities: [...scene.entities, op.entity] };
  case 'renameEntity': return editEntity(scene, op.entityId, e => ({ ...e, name: op.name }));
  case 'setTransform': return editEntity(scene, op.entityId, e => ({ ...e, transform: op.transform }));
  case 'setLight': return editEntity(scene, op.entityId, e => e.kind === 'light' ? { ...e, light: op.light } : e);
  case 'setHaze': return editEntity(scene, op.entityId, e => e.kind === 'haze' ? { ...e, haze: op.haze } : e);
  case 'setEnvironmentModel': return editEntity(scene, op.entityId, e => e.kind === 'environment' ? { ...e, assetId: op.assetId } : e);
  case 'setEnvironmentReflections': return editEntity(scene, op.entityId, e => e.kind === 'environment' ? { ...e, reflectionsIntensity: op.reflectionsIntensity } : e);
  default: return scene;
 }
};

export const withProposal = (state: WorkingState, f: (p: Proposal) => Partial<Proposal>): WorkingState => ({ ...state, proposal: { ...state.proposal, ...f(state.proposal) } });

export const emit = (state: WorkingState, ops: PatchOp[]): WorkingState =>
 withProposal({ ...state, scene: ops.reduce(applyToWorking, state.scene) }, p => ({ sceneOps: [...p.sceneOps, ...ops] }));

export const entityRef = (state: WorkingState, id: Id): Ref | undefined =>
 Object.hasOwn(state.proposal.refs.entities, id) ? state.proposal.refs.entities[id] : undefined;

export const create = (state: WorkingState, entity: SceneEntity): Reply<WorkingState> =>
 state.scene.entities.length >= SCENE_ENTITIES ? invalid(`Scene has the maximum of ${SCENE_ENTITIES} entities`)
  : ok(withProposal(emit(state, [{ kind: 'createEntity', entity }]), p => ({
   created: { ...p.created, entities: [...p.created.entities, entity.id] },
   refs: assignRefs(p.refs, { entities: [entity.id], blueprints: [], assets: [] }),
  })));

export const touch = (state: WorkingState, id: Id): WorkingState => withProposal(state, p =>
 p.created.entities.includes(id) || p.touched.entities.includes(id) ? {} : { touched: { ...p.touched, entities: [...p.touched.entities, id] } });

export const note = (state: WorkingState, n: Note): WorkingState => withProposal(state, p =>
 p.notes.some(x => x.code === n.code && x.ref === n.ref) ? {} : { notes: [...p.notes, n] });

export const resolveEntity = (state: WorkingState, ref: Ref, kinds: readonly SceneEntity['kind'][] | null, what: string): Reply<SceneEntity> => {
 const hit = resolveRef(state.proposal.refs, ref);
 const entity = hit?.kind === 'entity' ? state.scene.entities.find(e => e.id === hit.id) : undefined;
 return entity && (!kinds || kinds.includes(entity.kind)) ? ok(entity) : invalid(`${ref} is not ${what} in this scene`, [ref]);
};

export const resolveAsset = (state: WorkingState, context: CompileContext, ref: Ref, kinds: readonly AssetSummary['kind'][], what: string): Reply<AssetSummary> => {
 const hit = resolveRef(state.proposal.refs, ref);
 const asset = hit?.kind === 'asset' ? context.assets.find(a => a.id === hit.id) : undefined;
 return asset && kinds.includes(asset.kind) ? ok(asset) : invalid(`${ref} is not ${what}`, [ref]);
};

// An avatar-like stand-in at the origin: the last target fallback. It is never emitted.
const ORIGIN: SceneEntity = { id: '', name: 'origin', visible: true, kind: 'avatar', assetId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };

// A missing target falls back to the selection, then the first avatar, then the origin (R11).
export const resolveTarget = (state: WorkingState, context: CompileContext, ref: Ref | undefined): Reply<{ target: SceneEntity; state: WorkingState }> => {
 if (ref !== undefined) {
  const hit = resolveEntity(state, ref, null, 'an entity');
  return hit.ok ? ok({ target: hit.data, state }) : hit;
 }
 const found = state.scene.entities.find(e => e.id === context.selection) ?? state.scene.entities.find(e => e.kind === 'avatar');
 const r = found && entityRef(state, found.id);
 return ok({ target: found ?? ORIGIN, state: note(state, r ? { code: 'targetDefaulted', ref: r } : { code: 'targetDefaulted' }) });
};

// Adds a graph to the working Blueprints, or swaps the graph `replaced` for it with the same ID. A new graph is owned by Chat.
export const putGraph = (state: WorkingState, graph: BlueprintGraph, replaced: Id | null): Reply<WorkingState> => {
 if (replaced === null && state.blueprints.length >= SHOW_BLUEPRINTS) return invalid(`Show has the maximum of ${SHOW_BLUEPRINTS} Blueprints`);
 const ops: BlueprintOp[] = replaced === null ? [{ kind: 'createGraph', graph }] : [{ kind: 'removeGraph', graphId: replaced }, { kind: 'createGraph', graph }];
 // applyBlueprintOps checks the result with BlueprintSetSchema.
 const applied = applyBlueprintOps(state.blueprints, ops);
 if (!applied.ok) return applied;
 return ok(withProposal({ ...state, blueprints: applied.data }, p => replaced === null ? {
  blueprintOps: [...p.blueprintOps, ...ops],
  created: { ...p.created, blueprints: [...p.created.blueprints, graph.id] },
  refs: { ...assignRefs(p.refs, { entities: [], blueprints: [graph.id], assets: [] }), owned: [...p.refs.owned, graph.id] },
 } : {
  blueprintOps: [...p.blueprintOps, ...ops],
  play: p.play.filter(x => x.graphId !== replaced),
  touched: p.created.blueprints.includes(replaced) || p.touched.blueprints.includes(replaced) ? p.touched : { ...p.touched, blueprints: [...p.touched.blueprints, replaced] },
 }));
};
