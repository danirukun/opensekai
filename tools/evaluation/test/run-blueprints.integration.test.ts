import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importBlueprint, makeSmokeScene, type AppApi, type SceneView } from '@opensekai/contracts';
import { createSession, sessionApi } from '@opensekai/session';
import { evaluateBlueprintFiles } from '../src/run-blueprints';

const dir = new URL('../../../fixtures/blueprints/', import.meta.url);
const files = new Map(readdirSync(dir).filter(name => name.endsWith('.json')).map(name => [name.replace(/\.json$/, ''), readFileSync(new URL(name, dir), 'utf8')]));

function harness(scene: SceneView = makeSmokeScene()) {
 const session = createSession(scene, 'eval');
 let now = 0, n = 0;
 const api = { ...sessionApi(session), appStatus: async () => ({ ok: true, data: { schemaVersion: 1, sessionId: 'eval', ready: true, revision: session.inspect().revision, capabilities: ['read', 'edit'], warnings: [], outputs: [] } }) } as unknown as AppApi;
 const sleep = async (ms: number) => { for (let t = 0; t < ms; t += 16) { now += 16; session.advance(now, now); } };
 return { session, api, ports: { sleep, newId: () => `id-${++n}` } };
}

it('passes every check against a real session and leaves the session as it was', async () => {
 const { session, api, ports } = harness();
 const before = structuredClone(session.inspect().entities.find(e => e.id === 'reference')!.transform);
 const checks = await evaluateBlueprintFiles(api, files, ports);
 expect(checks.filter(check => !check.ok)).toEqual([]);
 expect(checks.map(check => check.name)).toEqual([
  'rejects future-version', 'rejects unknown-node', 'rejects warudo-shaped',
  'nudge', 'drift', 'wasd', 'camera-flip', 'counter', 'renamed-ids', 'missing-ref',
 ]);
 const stored = session.inspectBlueprints();
 expect(stored.kind === 'snapshot' && stored.blueprints).toEqual([]);
 expect(session.inspect().entities.find(e => e.id === 'reference')!.transform).toEqual(before);
});

it('refuses a scene other than the smoke scene', async () => {
 const { api, ports } = harness({ ...makeSmokeScene(), sceneId: 'my_show' } as SceneView);
 await expect(evaluateBlueprintFiles(api, files, ports)).rejects.toThrow('Open the smoke scene first');
});

it('runs against the authoring-style scene and leaves it as it was', async () => {
 const smoke = makeSmokeScene();
 const camera = { ...smoke.entities.find(e => e.id === 'camera_wide')!, id: 'camera_main', name: 'camera_main' };
 const { session, api, ports } = harness({ ...smoke, entities: [camera], outputs: smoke.outputs.map(o => ({ ...o, cameraId: 'camera_main' })) } as SceneView);
 const checks = await evaluateBlueprintFiles(api, files, ports);
 expect(checks.filter(check => !check.ok)).toEqual([]);
 expect(checks).toHaveLength(10);
 expect(session.inspect().entities.map(e => e.id)).toEqual(['camera_main']);
 const stored = session.inspectBlueprints();
 expect(stored.kind === 'snapshot' && stored.blueprints).toEqual([]);
});

it('refuses when a Blueprint exists', async () => {
 const { session, api, ports } = harness();
 const imported = importBlueprint(files.get('nudge')!, session.inspect(), ports.newId);
 if (!imported.ok) throw new Error('fixture import failed');
 expect((await api.blueprintEdit({ clientId: 't', batchId: 'b', ops: [{ kind: 'createGraph', graph: imported.data.graph }] } as never)).ok).toBe(true);
 const revision = session.inspect().revision;
 await expect(evaluateBlueprintFiles(api, files, ports)).rejects.toThrow('Remove the Blueprints first');
 expect(session.inspect().revision).toBe(revision);
});
