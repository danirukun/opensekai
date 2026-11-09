import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { IdSchema, type AppApi, type AssetList, type AssetSummary, type BlueprintGraph, type BlueprintInspect, type Id, type ProposalApplyResult, type Reply, type SceneView } from '@opensekai/contracts';
import { assignRefs, compileIntents, IntentSchemas, emptyRefs, lookUp, refOf, RefSchema, sceneSummary, toApplyParams, type CompileContext, type Intent, type Note, type Ref, type RefTable } from '@opensekai/assist';
import { failure, invokeTool, respond } from './tools';

const CLIENT_ID = 'opensekai-mcp-assist';
const ASSET_PAGES = 8;
type Read = { scene: SceneView; blueprints: BlueprintGraph[]; assets: AssetSummary[] };
type State = { refs: RefTable };
type SceneTool = Exclude<Intent['tool'], 'ask' | 'look_up'>;

const INTENT_DESCRIPTIONS: Record<SceneTool, string> = {
 light_setup: 'Add a key, fill, rim, or ambient light aimed at a target, or change the light in replace.',
 camera_add: 'Add a camera placed by framing, side, and height, aimed at a target.',
 camera_move: 'Make a camera move Blueprint (orbit, dolly, push-in, pull-out, or crane) and play it one time.',
 environment_set: 'Set the environment model to a scene asset, and optionally its reflections.',
 prop_place: 'Place 1 to 8 props from an asset near a reference.',
 haze_set: 'Set the haze density; off sets the density to 0.',
 output_camera: 'Show a camera on the first output.',
 blueprint_build: 'Make a Blueprint from one trigger and 1 to 8 actions in sequence, or rebuild a Blueprint that these tools made (replace); a hotkey is an accelerator such as Control+Shift+H and needs a Control, Alt, or Meta modifier.',
};
const SCENE_TOOLS = Object.keys(INTENT_DESCRIPTIONS) as SceneTool[];

const readAssets = async (api: AppApi, after?: Id, pages = 1, found: AssetSummary[] = []): Promise<Reply<AssetSummary[]>> => {
 const page = await invokeTool(api, 'assetList', after === undefined ? {} : { after });
 if (!page.ok) return page;
 const { assets, next } = page.data as AssetList;
 return next !== null && pages < ASSET_PAGES ? readAssets(api, next, pages + 1, [...found, ...assets]) : { ok: true, data: [...found, ...assets] };
};

// The persistent scene and the stored Blueprint documents: the values that proposalApply fingerprints.
const read = async (api: AppApi, sceneId: Id): Promise<Reply<Read>> => {
 const scene = await invokeTool(api, 'sceneInspect', { sceneId });
 if (!scene.ok) return scene;
 const graphs = await invokeTool(api, 'blueprintInspect', {});
 if (!graphs.ok) return graphs;
 const inspect = graphs.data as BlueprintInspect;
 if (inspect.kind !== 'snapshot') return failure('UNAVAILABLE', 'Blueprint snapshot unavailable');
 const assets = await readAssets(api);
 return assets.ok ? { ok: true, data: { scene: scene.data as SceneView, blueprints: inspect.blueprints, assets: assets.data } } : assets;
};

const withScene = (refs: RefTable, { scene, blueprints }: Read) =>
 assignRefs(refs, { entities: scene.entities.map(e => e.id), blueprints: blueprints.map(b => b.id), assets: [] });

export async function runIntent(api: AppApi, state: State, sceneId: Id, intent: Intent): Promise<Reply<{ revision: number; created: Ref[]; notes: Note[] }>> {
 const current = await read(api, sceneId);
 if (!current.ok) return current;
 const context: CompileContext = { ...current.data, refs: withScene(state.refs, current.data), selection: null, newId: kind => `chat_${kind}_${crypto.randomUUID()}` };
 const compiled = compileIntents([intent], context);
 if (!compiled.ok) return compiled;
 const proposal = compiled.data;
 const applied = await invokeTool(api, 'proposalApply', toApplyParams(proposal, context, { clientId: CLIENT_ID, batchId: crypto.randomUUID() }));
 if (!applied.ok) return applied;
 state.refs = proposal.refs;
 // The proposal is applied, so a failed Play run is a note, not an error; blueprint_run can play the move again.
 const failed: Note[] = [];
 for (const { graphId, nodeId } of proposal.play) {
  const run = await invokeTool(api, 'blueprintRun', { graphId, triggerNodeId: nodeId });
  if (!run.ok) failed.push({ code: 'playFailed', ref: refOf(proposal.refs, 'blueprint', graphId) });
 }
 const created = [...proposal.created.entities.map(id => refOf(proposal.refs, 'entity', id)), ...proposal.created.blueprints.map(id => refOf(proposal.refs, 'blueprint', id))];
 return { ok: true, data: { revision: (applied.data as ProposalApplyResult).revision, created, notes: [...proposal.notes, ...failed] } };
}

const SummaryParams = z.strictObject({ sceneId: IdSchema, prompt: z.string().max(1000).optional() });
const LookUpParams = z.strictObject({ sceneId: IdSchema, ref: RefSchema });
const AskParams = IntentSchemas.ask.omit({ tool: true });

export function registerAssistTools(server: McpServer, api: AppApi): void {
 const state: State = { refs: emptyRefs() };
 // One call at a time, so two calls never assign the same reference to different IDs.
 let queue: Promise<unknown> = Promise.resolve();
 const serial = <T>(f: () => Promise<T>): Promise<T> => { const run = queue.then(f, f); queue = run.catch(() => undefined); return run; };
 server.registerTool('scene_summary', { description: 'Read the scene as one line for each entity, Blueprint, and matching asset, each with a reference (@e, @b, @a) to use in the other tools.', inputSchema: SummaryParams }, async params => respond(await serial(async () => {
  const current = await read(api, params.sceneId);
  if (!current.ok) return current;
  const summary = sceneSummary({ ...current.data, refs: state.refs, selection: null, ...(params.prompt === undefined ? {} : { prompt: params.prompt }) });
  state.refs = summary.refs;
  return { ok: true, data: { text: summary.text } };
 })));
 server.registerTool('look_up', { description: 'Read the details of one reference.', inputSchema: LookUpParams }, async params => respond(await serial(async () => {
  const current = await read(api, params.sceneId);
  if (!current.ok) return current;
  state.refs = withScene(state.refs, current.data);
  const text = lookUp({ ...current.data, refs: state.refs, selection: null, ref: params.ref });
  return text.ok ? { ok: true, data: { text: text.data } } : text;
 })));
 server.registerTool('ask', { description: 'Ask the user one question with 2 to 5 choices.', inputSchema: AskParams }, async params => respond({ ok: true, data: params }));
 for (const tool of SCENE_TOOLS) {
  const intent: z.ZodObject = IntentSchemas[tool];
  const inputSchema = intent.omit({ tool: true }).extend({ sceneId: IdSchema });
  server.registerTool(tool, { description: INTENT_DESCRIPTIONS[tool], inputSchema }, async (params: unknown) => {
   const { sceneId, ...fields } = params as { sceneId: Id };
   return respond(await serial(() => runIntent(api, state, sceneId, { ...fields, tool } as Intent)));
  });
 }
}
