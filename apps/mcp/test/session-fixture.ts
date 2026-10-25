import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { makeSmokeScene, type AppApi, type AssetRecord, type SceneView } from '@opensekai/contracts';
import { createSession, sessionApi } from '@opensekai/session';
import { createMcpServer } from '../src/server';
import { fixtureApi } from './stdio-fixture';

// The smoke scene, or with OPENSEKAI_FIXTURE_SCENE=twin a scene in which two cameras are named camera_wide.
export function sceneFor(name: string | undefined): SceneView {
 const scene = makeSmokeScene();
 return name === 'twin' ? { ...scene, entities: scene.entities.map(e => e.id === 'camera_close' ? { ...e, name: 'camera_wide' } : e) } as SceneView : scene;
}
// The smoke avatar model, with two triggerable expressions and one that tracking drives.
export const fixtureAvatar: AssetRecord = { id: 'fixture_vrm_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'fixture', importerVersion: 1, name: 'Fixture', expressions: [{ name: 'happy', preset: true }, { name: 'aa', preset: true }, { name: 'Wink', preset: false }] };
// The host reports a status for each VMC sender; this fixture host reports each sender of the session scene as stopped or waiting.
export const sessionFixtureApi = (scene: SceneView): AppApi => {
 const session = createSession(scene, 'fixture', [fixtureAvatar]), base = fixtureApi();
 return { ...base, ...sessionApi(session), appStatus: async params => {
  const status = await base.appStatus(params);
  const vmcSenders = session.inspect().entities.flatMap(e => e.kind === 'vmcSender' ? [{ entityId: e.id, state: e.vmcSender.enabled ? 'waiting' as const : 'stopped' as const, datagrams: 0, errors: 0, error: null }] : []);
  return status.ok && vmcSenders.length ? { ok: true, data: { ...status.data, vmcSenders } } : status;
 } };
};

if (process.argv[1]?.endsWith('session-fixture.ts')) {
 const server = createMcpServer(sessionFixtureApi(sceneFor(process.env.OPENSEKAI_FIXTURE_SCENE)), async () => { throw new Error('NOT_FOUND'); });
 process.stderr.write('session fixture ready\n');
 await server.connect(new StdioServerTransport());
}
