import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { makeSmokeScene, type AppApi, type SceneView } from '@opensekai/contracts';
import { createSession, sessionApi } from '@opensekai/session';
import { createMcpServer } from '../src/server';
import { fixtureApi } from './stdio-fixture';

// The smoke scene, or with OPENSEKAI_FIXTURE_SCENE=twin a scene in which two cameras are named camera_wide.
export function sceneFor(name: string | undefined): SceneView {
 const scene = makeSmokeScene();
 return name === 'twin' ? { ...scene, entities: scene.entities.map(e => e.id === 'camera_close' ? { ...e, name: 'camera_wide' } : e) } as SceneView : scene;
}
export const sessionFixtureApi = (scene: SceneView): AppApi => ({ ...fixtureApi(), ...sessionApi(createSession(scene, 'fixture')) });

if (process.argv[1]?.endsWith('session-fixture.ts')) {
 const server = createMcpServer(sessionFixtureApi(sceneFor(process.env.OPENSEKAI_FIXTURE_SCENE)), async () => { throw new Error('NOT_FOUND'); });
 process.stderr.write('session fixture ready\n');
 await server.connect(new StdioServerTransport());
}
