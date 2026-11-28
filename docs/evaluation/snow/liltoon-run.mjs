// Slice 3 of the snow design: snow on lilToon characters and on the outlines of both kinds, in the OBS output.
// Usage (repository root, app running): node docs/evaluation/snow/liltoon-run.mjs [captures folder]. The default folder is ./captures next to this file.
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcp, obs, wait } from './qa.mjs';

const here = dirname(fileURLToPath(import.meta.url)), out = process.argv[2] ?? join(here, 'captures');
mkdirSync(out, { recursive: true });
const app = join(homedir(), 'Library/Application Support/com.oshi-connect.opensekai');
const descriptor = JSON.parse(readFileSync(join(app, 'renderer-output_main.json'), 'utf8'));
const url = `${descriptor.httpOrigin}/renderer/?quality=production_v1#${encodeURIComponent(JSON.stringify(descriptor))}`;
const SCENE = 'OpenSekai-QA-snow-liltoon', SOURCE = 'OpenSekai-QA-snow-liltoon-renderer';
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
const performer = (id, name, assetId, x) => ({ id, name, visible: true, transform: transform([x, 0, 0]), kind: 'avatar', assetId });
const snow = { rate: 1, fallSpeed: 1, flakeSize: 1, flutter: 1, windDirection: 0, windSpeed: 0, buildUpSeconds: 15, meltSeconds: 20, thickness: 0.015, settleOnCharacters: true, settleOnProps: true, settleOnEnvironment: true };
const pitch = degrees => [Math.sin(degrees * Math.PI / 360), 0, 0, Math.cos(degrees * Math.PI / 360)];
const camera = (position, degrees = 0) => patch([{ kind: 'setTransform', entityId: 'camera_main', transform: transform(position, pitch(degrees)) }]);
const capture = async label => {
    await wait(1500);
    await o.request('SaveSourceScreenshot', { sourceName: SOURCE, imageFormat: 'png', imageFilePath: join(out, `${label}.png`) });
    log('captured', label);
};
const original = (await scene()).entities.filter(e => ['camera_main', 'light_key', 'light_back'].includes(e.id));

try {
    const left = (await scene()).entities.filter(e => ['perf_a', 'perf_b', 'roof', 'snow_qa'].includes(e.id));
    if (left.length) await patch(left.map(e => ({ kind: 'removeEntity', entityId: e.id })));
    await o.request('CreateScene', { sceneName: SCENE });
    await o.request('CreateInput', { sceneName: SCENE, inputName: SOURCE, inputKind: 'browser_source', inputSettings: { url, width: 1920, height: 1080, fps_custom: true, fps: 60, shutdown: false, reroute_audio: false } });
    await o.request('SetCurrentProgramScene', { sceneName: SCENE });
    log('OBS scene ready, program was', program);
    // A and B: the lilToon Catboy, in the T-pose (no tracking source). A scene holds at most 2 avatars. The roof shelters the head
    // of B only: if two lilToon avatars read one state buffer, A and B show the same snow.
    await patch([
        { kind: 'createEntity', entity: performer('perf_a', 'lilToon A', LILTOON, -0.9) },
        { kind: 'createEntity', entity: performer('perf_b', 'lilToon B', LILTOON, 0.9) },
        { kind: 'createEntity', entity: { id: 'roof', name: 'Roof', visible: true, transform: transform([0.9, 1.95, 0], [0, 0, 0, 1], [0.5, 0.03, 0.5]), kind: 'mesh', source: { kind: 'box' } } },
    ]);
    await camera([0, 1.1, 5.5]);
    await wait(15000);
    await capture('l0-no-snow');
    const first = Date.now();
    await patch([{ kind: 'createEntity', entity: { id: 'snow_qa', name: 'Snow', visible: true, transform: transform([0, 2, 0], [0, 0, 0, 1], [6, 4, 6]), kind: 'snow', snow } }]);
    log('snow on, rate 1, buildUpSeconds 15');
    for (let frame; Date.now() - first < 20000; await wait(100)) {
        frame = (await m.call('app_status')).data.outputs.find(item => item.outputId === 'output_main')?.lastFrame;
        if (frame?.revision === revision) { log('first output_main frame at the snow revision', JSON.stringify({ cpuMs: frame.cpuMs, gpuMs: frame.gpuMs, warnings: frame.warnings })); break; }
    }
    await wait(30000);
    await capture('l1-wide');
    const close = x => camera([x, 1.45, 1.6], -8);
    // The key light from below and in front, and no back light: the tops face away from each light, so the snow on them is
    // in the band shadow and shows the shade. With the key light from above, the snow colour clips at intensity 3.
    const underLight = () => patch([
        { kind: 'setTransform', entityId: 'light_key', transform: transform([0, -3, 3], [0.382683, 0, 0, 0.92388]) },
        { kind: 'setVisibility', entityId: 'light_back', visible: false },
    ]);
    const keyLight = () => patch([
        { kind: 'setTransform', entityId: 'light_key', transform: original.find(e => e.id === 'light_key').transform },
        { kind: 'setVisibility', entityId: 'light_back', visible: true },
    ]);
    // The outline at the silhouette with the thickest layer, then the shade.
    const closeUps = async (x, label) => {
        await close(x);
        await capture(`${label}-close`);
        await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow: { ...snow, thickness: 0.05 } }]);
        await capture(`${label}-thick`);
        await patch([{ kind: 'setSnow', entityId: 'snow_qa', snow }]);
        await underLight();
        await capture(`${label}-under-light`);
        await keyLight();
    };
    await closeUps(-0.9, 'l2-liltoon-a');
    await close(0.9);
    await capture('l3-liltoon-b-roof');
    log('materials', JSON.stringify((await m.call('material_list', { entityId: 'perf_a' })).data).slice(0, 3000));
    // B becomes the MToon Catboy, without the roof. Its new build-up warm starts from the session cover.
    await patch([{ kind: 'removeEntity', entityId: 'roof' }, { kind: 'setAvatarModel', entityId: 'perf_b', assetId: MTOON }]);
    await wait(20000);
    await camera([0, 1.1, 5.5]);
    await capture('l4-mixed-wide');
    await closeUps(0.9, 'l5-mtoon-b');
    const final = (await m.call('app_status')).data;
    log('warnings', JSON.stringify(final.warnings), JSON.stringify(final.outputs.map(item => [item.outputId, item.lastFrame?.backend, item.lastFrame?.qualityProfile, item.lastFrame?.warnings])));
} finally {
    await patch(original.flatMap(e => [{ kind: 'setTransform', entityId: e.id, transform: e.transform }, { kind: 'setVisibility', entityId: e.id, visible: e.visible }])).catch(error => log(String(error)));
    await o.request('SetCurrentProgramScene', { sceneName: program }).catch(error => log(String(error)));
    await o.request('RemoveScene', { sceneName: SCENE }).catch(error => log(String(error)));
    log('OBS program restored to', program);
    o.close(); m.close();
}
