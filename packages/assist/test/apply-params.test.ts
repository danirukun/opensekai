import { describe, expect, it } from 'vitest';
import { fingerprint, ProposalApplyParamsSchema, type Reply } from '@opensekai/contracts';
import { assignRefs, compileIntents, toApplyParams, type Intent } from '../src';
import { ctx, graph, scene, summaryRefs } from './context';

const data = <T>(r: Reply<T>): T => { if (!r.ok) throw new Error(r.error.message); return r.data; };
const batch = { clientId: 'opensekai-test', batchId: 'batch_1' };

describe('toApplyParams', () => {
 it('apply params expect current fingerprints and absent created IDs', () => {
  const context = ctx();
  const intents: Intent[] = [
   { tool: 'light_setup', role: 'key', replace: '@e3' },
   { tool: 'camera_add', framing: 'closeUp' },
   { tool: 'camera_move', camera: '@e7', kind: 'orbit', angleDegrees: 90 },
   { tool: 'output_camera', camera: '@e7' },
  ];
  const p = data(compileIntents(intents, context));
  const params = toApplyParams(p, context, batch);
  const lamp = scene.entities.find(e => e.id === 'lamp')!;
  expect(params.sceneId).toBe(scene.sceneId);
  expect(params.expect.entities).toEqual([{ id: 'lamp', fingerprint: fingerprint(lamp) }, { id: 'chat_camera_1', fingerprint: null }]);
  expect(params.expect.blueprints).toEqual([{ id: 'chat_blueprint_1', fingerprint: null }]);
  expect(params.sceneOps).toEqual(p.sceneOps);
  expect(params.blueprint).toEqual({ ...batch, ops: p.blueprintOps });
  expect(params.output).toEqual({ outputId: scene.outputs[0]!.id, cameraId: 'chat_camera_1' });
  expect(ProposalApplyParamsSchema.safeParse(params).success).toBe(true);
 });

 it('expects the fingerprint of a replaced graph and takes an output ID', () => {
  const old = graph('chat_old', 'Old');
  const refs = { ...assignRefs(summaryRefs, { entities: [], blueprints: ['chat_old'], assets: [] }), owned: ['chat_old'] };
  const context = ctx({ blueprints: [old], refs });
  const p = data(compileIntents([
   { tool: 'blueprint_build', name: 'Wave', trigger: { kind: 'manual' }, actions: [{ kind: 'emit', name: 'Wave' }], replace: '@b1' },
   { tool: 'output_camera', camera: '@e6' },
  ], context));
  const params = toApplyParams(p, context, batch, 'preview_main');
  expect(params.expect).toEqual({ entities: [], blueprints: [{ id: 'chat_old', fingerprint: fingerprint(old) }] });
  expect(params.output).toEqual({ outputId: 'preview_main', cameraId: 'camera_close' });
  expect(ProposalApplyParamsSchema.safeParse(params).success).toBe(true);
 });

 it('has no Blueprint batch and no output when the proposal has none', () => {
  const context = ctx();
  const params = toApplyParams(data(compileIntents([{ tool: 'haze_set', density: 'light' }], context)), context, batch);
  expect(params.blueprint).toBeNull();
  expect(params.output).toBeNull();
  expect(params.expect.entities).toEqual([{ id: 'chat_haze_1', fingerprint: null }]);
  expect(ProposalApplyParamsSchema.safeParse(params).success).toBe(true);
 });
});
