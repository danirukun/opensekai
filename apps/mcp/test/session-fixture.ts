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
export const sessionFixtureApi = (scene: SceneView): AppApi => ({ ...fixtureApi(), ...sessionApi(createSession(scene, 'fixture', [fixtureAvatar])) });

// With OPENSEKAI_FIXTURE_TRACKING=1 the scene has an enabled tracking source `phone` that has already received one sample (jawOpen .4, eyeBlink_L .2).
function trackingFixtureApi(scene: SceneView): AppApi {
 const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
 const config = { kind: 'ifacialmocap', enabled: true, bindAddress: '127.0.0.1', port: 49983, phoneAddress: null };
 const session = createSession(scene, 'fixture', [fixtureAvatar]);
 session.applyPatch({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations: [{ kind: 'createEntity', entity: { id: 'phone', name: 'Phone', visible: true, transform, kind: 'tracking', generation: 0, config } }] } as never);
 const generation = (session.inspect().entities.find(entity => entity.id === 'phone') as { generation: number }).generation;
 session.ingestTracking({ samples: [{ sourceId: 'phone', generation, receivedAtMs: 1000, bones: {}, expressions: { jawOpen: .4, eyeBlink_L: .2 } }], statuses: [] });
 session.advance(0, 1000);
 return { ...fixtureApi(), ...sessionApi(session) };
}

if (process.argv[1]?.endsWith('session-fixture.ts')) {
 const server = createMcpServer((process.env.OPENSEKAI_FIXTURE_TRACKING ? trackingFixtureApi : sessionFixtureApi)(sceneFor(process.env.OPENSEKAI_FIXTURE_SCENE)), async () => { throw new Error('NOT_FOUND'); });
 process.stderr.write('session fixture ready\n');
 await server.connect(new StdioServerTransport());
}
