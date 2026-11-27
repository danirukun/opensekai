// Evidence 5 of the snow design: the preview and OBS show the same cover after an OBS source reload.
// Usage (repository root, app running): node docs/evaluation/snow/cover-run.mjs [captures folder]. The default folder is ./captures next to this file.
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcp, obs, wait } from './qa.mjs';

const here = dirname(fileURLToPath(import.meta.url)), out = process.argv[2] ?? join(here, 'captures');
mkdirSync(out, { recursive: true });
const app = join(homedir(), 'Library/Application Support/com.oshi-connect.opensekai');
const descriptor = JSON.parse(readFileSync(join(app, 'renderer-output_main.json'), 'utf8'));
const url = `${descriptor.httpOrigin}/renderer/?quality=production_v1#${encodeURIComponent(JSON.stringify(descriptor))}`;
const SCENE = 'OpenSekai-QA-snow-cover', SOURCE = 'OpenSekai-QA-snow-cover-renderer';
const t0 = Date.now(), log = (...args) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...args);

const o = await obs(), m = await mcp();
const { currentProgramSceneName: program } = await o.request('GetSceneList');
const status = async () => (await m.call('app_status')).data;
let revision = (await m.call('scene_inspect', { sceneId: 'scene_smoke' })).data.revision;
const patch = async operations => {
    const reply = await m.call('scene_patch', { sceneId: 'scene_smoke', expectedRevision: revision, operations });
    if (!reply.ok) throw new Error(JSON.stringify(reply.error));
    revision = reply.data.revision;
};
const snowEntity = { id: 'snow_qa', name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { rate: 1, fallSpeed: 1, flakeSize: 1, flutter: 1, windDirection: 0, windSpeed: 0, buildUpSeconds: 45, meltSeconds: 20, thickness: 0.015, settleOnCharacters: true, settleOnProps: true, settleOnEnvironment: true } };
const setSnow = settings => patch([{ kind: 'setSnow', entityId: 'snow_qa', snow: { ...snowEntity.snow, ...settings } }]);
let settings = {};
const capture = async label => {
    const obsFile = join(out, `${label}-obs.png`);
    await o.request('SaveSourceScreenshot', { sourceName: SOURCE, imageFormat: 'png', imageFilePath: obsFile });
    const shot = await m.call('camera_screenshot', { cameraId: 'camera_main', expectedRevision: revision });
    const name = shot.data?.fileName ?? shot.data?.file ?? shot.data?.name ?? shot.data;
    if (typeof name === 'string') copyFileSync(join(app, 'screenshots', name), join(out, `${label}-preview.png`));
    else log('camera_screenshot', JSON.stringify(shot).slice(0, 200));
    log('captured', label);
    await wait(1100);
};
const reloadObs = async () => {
    await o.request('PressInputPropertiesButton', { inputName: SOURCE, propertyName: 'refreshnocache' });
    log('OBS source reloaded');
    // Wait for the page to load and to apply frames again.
    const before = Date.now();
    await wait(1500);
    for (let last = null; Date.now() - before < 20000; await wait(250)) {
        const frame = (await status()).outputs.find(item => item.outputId === 'output_main')?.lastFrame;
        if (frame && last && frame.sequence > last.sequence && frame.revision === revision) { log('output_main applies frames', frame.backend, frame.qualityProfile); break; }
        last = frame ?? last;
    }
    await wait(1500);
};

try {
    const left = (await m.call('scene_inspect', { sceneId: 'scene_smoke' })).data.entities.filter(e => e.id === 'performer' || e.id === 'snow_qa');
    if (left.length) await patch(left.map(e => ({ kind: 'removeEntity', entityId: e.id })));
    await o.request('CreateScene', { sceneName: SCENE });
    await o.request('CreateInput', { sceneName: SCENE, inputName: SOURCE, inputKind: 'browser_source', inputSettings: { url, width: 1920, height: 1080, fps_custom: true, fps: 60, shutdown: false, reroute_audio: false } });
    await o.request('SetCurrentProgramScene', { sceneName: SCENE });
    log('OBS scene ready, program was', program);
    await patch([{ kind: 'createEntity', entity: { id: 'performer', name: 'Catboy', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'avatar', assetId: 'avatar_7b7c689e4e2ad3e6f6fe6cdb615ffad76d81ff788fcf61e7b9473fa73e024373' } }]);
    await wait(12000);
    await patch([{ kind: 'createEntity', entity: snowEntity }]);
    log('snow on, rate 1, buildUpSeconds 45');
    // A: build-up. Cover at 40 s is 0.89.
    await wait(40000);
    await capture('a1-grow-before-reload');
    await reloadObs();
    await capture('a2-grow-after-reload');
    // Full cover, then the melt.
    await wait(25000);
    await setSnow(settings = { rate: 0 });
    log('rate 0');
    await wait(7000);
    await capture('b1-melt-before-reload');
    await reloadObs();
    await capture('b2-melt-after-reload');
    // C: Settle On Characters off and on again at full cover.
    await setSnow(settings = { rate: 1 });
    log('rate 1');
    await wait(50000);
    await setSnow(settings = { settleOnCharacters: false });
    log('settle off');
    await wait(2000);
    await capture('c1-settle-off');
    await setSnow(settings = { settleOnCharacters: true });
    log('settle on');
    await wait(1500);
    await capture('c2-settle-on');
    const final = await status();
    log('warnings', JSON.stringify(final.warnings), JSON.stringify(final.outputs.map(item => [item.outputId, item.lastFrame?.backend, item.lastFrame?.qualityProfile, item.lastFrame?.warnings])));
} finally {
    await o.request('SetCurrentProgramScene', { sceneName: program }).catch(error => log(String(error)));
    await o.request('RemoveScene', { sceneName: SCENE }).catch(error => log(String(error)));
    log('OBS program restored to', program);
    o.close(); m.close();
}
