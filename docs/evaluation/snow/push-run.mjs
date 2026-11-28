// Snow on lilToon R11: the push of each split position, in the OBS output. lilToon Catboy A and MToon Catboy B; for each, the
// glasses from the front and from above and the shoulder seam, with Settle On Characters off, then on at thickness 0, 0.015,
// and 0.05. The scene stays at the end (A, B, and the snow) for a look in the editor; the camera goes back.
// Usage (repository root, app running): node docs/evaluation/snow/push-run.mjs [captures folder].
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
const SCENE = 'OpenSekai-QA-snow-push', SOURCE = 'OpenSekai-QA-snow-push-renderer';
const LILTOON = 'avatar_2cd7340b7a54ee03a2ce53cb6e80cb0b54933cd500339c1a8e4c679a947403da';
const MTOON = 'avatar_7b7c689e4e2ad3e6f6fe6cdb615ffad76d81ff788fcf61e7b9473fa73e024373';
const t0 = Date.now(), log = (...args) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...args);

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
const pitch = degrees => [Math.sin(degrees * Math.PI / 360), 0, 0, Math.cos(degrees * Math.PI / 360)];
const performer = (id, name, assetId, x) => ({ id, name, visible: true, transform: transform([x, 0, 0]), kind: 'avatar', assetId });
const snow = { rate: 1, fallSpeed: 1, flakeSize: 1, flutter: 1, windDirection: 0, windSpeed: 0, buildUpSeconds: 15, meltSeconds: 20, thickness: 0.015, settleOnCharacters: true, settleOnProps: true, settleOnEnvironment: true };
const capture = async label => {
    await wait(1500);
    await o.request('SaveSourceScreenshot', { sourceName: SOURCE, imageFormat: 'png', imageFilePath: join(out, `${label}.png`) });
    log('captured', label);
};
const original = (await scene()).entities.find(e => e.id === 'camera_main');
const views = x => ({ front: transform([x, 1.47, 0.75], pitch(-3)), top: transform([x, 2.1, 0.55], pitch(-50)), seam: transform([x - 0.25, 1.42, 0.9], pitch(-8)) });

try {
    const left = (await scene()).entities.filter(e => ['perf_a', 'perf_b', 'roof', 'snow_qa'].includes(e.id));
    if (left.length) await patch(left.map(e => ({ kind: 'removeEntity', entityId: e.id })));
    await o.request('CreateScene', { sceneName: SCENE });
    await o.request('CreateInput', { sceneName: SCENE, inputName: SOURCE, inputKind: 'browser_source', inputSettings: { url, width: 1920, height: 1080, fps_custom: true, fps: 60, shutdown: false, reroute_audio: false } });
    await o.request('SetCurrentProgramScene', { sceneName: SCENE });
    await patch([
        { kind: 'createEntity', entity: performer('perf_a', 'lilToon A', LILTOON, -0.9) },
        { kind: 'createEntity', entity: performer('perf_b', 'MToon B', MTOON, 0.9) },
        { kind: 'createEntity', entity: { id: 'snow_qa', name: 'Snow', visible: true, transform: transform([0, 2, 0], [0, 0, 0, 1], [6, 4, 6]), kind: 'snow', snow } },
    ]);
    log('performers and snow added; waiting for the full cover');
    for (let frame; ; await wait(500)) {
        frame = (await m.call('app_status')).data.outputs.find(item => item.outputId === 'output_main')?.lastFrame;
        if (frame?.revision === revision) { log('output_main at the revision', JSON.stringify({ backend: frame.backend, qualityProfile: frame.qualityProfile, warnings: frame.warnings })); break; }
        if (Date.now() - t0 > 60000) throw new Error('output_main sent no frame at the revision');
    }
    await wait(40000);
    for (const [x, tag] of [[-0.9, 'liltoon'], [0.9, 'mtoon']]) {
        for (const [view, at] of Object.entries(views(x))) {
            await patch([{ kind: 'setTransform', entityId: 'camera_main', transform: at }]);
            await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow: { ...snow, settleOnCharacters: false } }]);
            await capture(`p-${tag}-${view}-off`);
            for (const thickness of [0, 0.015, 0.05]) {
                await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow: { ...snow, thickness } }]);
                await capture(`p-${tag}-${view}-${thickness}`);
            }
            await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow }]);
        }
    }
    const final = (await m.call('app_status')).data;
    log('warnings', JSON.stringify(final.warnings), JSON.stringify(final.outputs.map(item => [item.outputId, item.lastFrame?.backend, item.lastFrame?.qualityProfile, item.lastFrame?.warnings])));
} finally {
    await patch([{ kind: 'setTransform', entityId: 'camera_main', transform: original.transform }]).catch(error => log(String(error)));
    await o.request('SetCurrentProgramScene', { sceneName: program }).catch(error => log(String(error)));
    await o.request('RemoveScene', { sceneName: SCENE }).catch(error => log(String(error)));
    log('OBS program restored to', program);
    o.close(); m.close();
}
