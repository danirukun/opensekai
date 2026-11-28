// Slice 3 seam check: a close-up of the right shoulder (image left) of each performer with Settle On Characters off, then on at
// thickness 0.015 and 0.05. Run after liltoon-run.mjs (lilToon A, MToon B, and the snow entity stay in the scene).
// Usage (repository root, app running): node docs/evaluation/snow/liltoon-seam.mjs [captures folder].
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcp, obs, wait } from './qa.mjs';

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'captures');
mkdirSync(out, { recursive: true });
const app = join(homedir(), 'Library/Application Support/com.oshi-connect.opensekai');
const descriptor = JSON.parse(readFileSync(join(app, 'renderer-output_main.json'), 'utf8'));
const url = `${descriptor.httpOrigin}/renderer/?quality=production_v1#${encodeURIComponent(JSON.stringify(descriptor))}`;
const SCENE = 'OpenSekai-QA-snow-seam', SOURCE = 'OpenSekai-QA-snow-seam-renderer';
const o = await obs(), m = await mcp();
const { currentProgramSceneName: program } = await o.request('GetSceneList');
const scene = async () => (await m.call('scene_inspect', { sceneId: 'scene_smoke' })).data;
let revision = (await scene()).revision;
const patch = async operations => {
    const reply = await m.call('scene_patch', { sceneId: 'scene_smoke', expectedRevision: revision, operations });
    if (!reply.ok) throw new Error(JSON.stringify(reply.error));
    revision = reply.data.revision;
};
const transform = (position, rotation = [0, 0, 0, 1], scale = [1, 1, 1]) => ({ position, rotation, scale });
const pitch = d => [Math.sin(d * Math.PI / 360), 0, 0, Math.cos(d * Math.PI / 360)];
const snow = (await scene()).entities.find(e => e.id === 'snow_qa').snow;
const original = (await scene()).entities.find(e => e.id === 'camera_main');
const capture = async label => { await wait(2000); await o.request('SaveSourceScreenshot', { sourceName: SOURCE, imageFormat: 'png', imageFilePath: join(out, `${label}.png`) }); console.log('captured', label); };
try {
    await o.request('CreateScene', { sceneName: SCENE });
    await o.request('CreateInput', { sceneName: SCENE, inputName: SOURCE, inputKind: 'browser_source', inputSettings: { url, width: 1920, height: 1080, fps_custom: true, fps: 60, shutdown: false, reroute_audio: false } });
    await o.request('SetCurrentProgramScene', { sceneName: SCENE });
    await wait(8000);
    for (const [x, tag] of [[-0.9, 'liltoon'], [0.9, 'mtoon']]) {
        await patch([{ kind: 'setTransform', entityId: 'camera_main', transform: transform([x - 0.25, 1.42, 0.9], pitch(-8)) }]);
        await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow: { ...snow, settleOnCharacters: false } }]);
        await capture(`seam-${tag}-off`);
        await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow }]);
        await capture(`seam-${tag}-on`);
        await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow: { ...snow, thickness: 0.05 } }]);
        await capture(`seam-${tag}-thick`);
        await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow }]);
    }
    console.log(JSON.stringify((await m.call('app_status')).data.warnings));
} finally {
    await patch([{ kind: 'setTransform', entityId: 'camera_main', transform: original.transform }]).catch(e => console.log(String(e)));
    await o.request('SetCurrentProgramScene', { sceneName: program }).catch(e => console.log(String(e)));
    await o.request('RemoveScene', { sceneName: SCENE }).catch(e => console.log(String(e)));
    o.close(); m.close();
}
