#!/usr/bin/env node
// Minimal obs-websocket v5 client (no auth, loopback only) for isolated OpenSekai QA sources.
// It never starts streaming or recording, and teardown restores the prior program scene.
//   node obs.mjs status                                   OBS version, video settings, program scene, stream/record state
//   node obs.mjs setup --state <file> [--renderer <renderer-output_main.json>] [--program]
//        creates scene "OpenSekai-QA-<id>" with a browser source showing the app output.
//        --program switches the program scene to it (restored by teardown).
//   node obs.mjs screenshot --state <file> --out <png> [--width 1920 --height 1080]
//   node obs.mjs stats                                    render/output skipped frame counters
//   node obs.mjs teardown --state <file>                  restores the program scene, removes the QA scene and source
// Options: --url ws://127.0.0.1:4455
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const [command, ...rest] = process.argv.slice(2);
const opts = Object.fromEntries(rest.reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? true : all[index + 1]]] : pairs), []));
const url = opts.url ?? 'ws://127.0.0.1:4455';
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) fail('OBS must be a loopback endpoint.');

const socket = new WebSocket(url);
const waiting = new Map();
let identified;
const ready = new Promise((settle, reject) => { identified = { settle, reject }; });
socket.addEventListener('message', event => {
  const { op, d } = JSON.parse(event.data);
  if (op === 0) {
    if (d.authentication) return identified.reject(new Error('OBS asks for a password. This skill only uses the local endpoint without auth.'));
    socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } }));
  } else if (op === 2) identified.settle();
  else if (op === 7 && waiting.has(d.requestId)) {
    const { settle, reject } = waiting.get(d.requestId);
    waiting.delete(d.requestId);
    d.requestStatus.result ? settle(d.responseData ?? {}) : reject(new Error(`${d.requestType}: ${d.requestStatus.comment ?? d.requestStatus.code}`));
  }
});
socket.addEventListener('error', () => identified.reject(new Error(`Cannot connect to OBS at ${url}. Is OBS running with the WebSocket server on?`)));

const call = (requestType, requestData = {}) => new Promise((settle, reject) => {
  const requestId = randomUUID();
  waiting.set(requestId, { settle, reject });
  socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
});

const readState = () => {
  if (!opts.state || !existsSync(opts.state)) fail('Pass --state <file> from setup.');
  return JSON.parse(readFileSync(opts.state, 'utf8'));
};

const outputUrl = rendererFile => {
  const renderer = JSON.parse(readFileSync(rendererFile, 'utf8'));
  if (renderer.role !== 'renderer' || !renderer.outputId) fail(`${rendererFile} is not a renderer descriptor.`);
  return `${new URL(renderer.httpOrigin).origin}/renderer/#${encodeURIComponent(JSON.stringify(renderer))}`;
};

try {
  await ready;
  if (command === 'status') {
    const [version, video, program, stream, record] = await Promise.all([
      call('GetVersion'), call('GetVideoSettings'), call('GetCurrentProgramScene'), call('GetStreamStatus'), call('GetRecordStatus'),
    ]);
    print({ obsVersion: version.obsVersion, websocketVersion: version.obsWebSocketVersion, video: `${video.outputWidth}x${video.outputHeight}@${video.fpsNumerator / video.fpsDenominator}`, programScene: program.currentProgramSceneName, streaming: stream.outputActive, recording: record.outputActive });
  } else if (command === 'setup') {
    if (!opts.state) fail('Pass --state <file>.');
    const rendererFile = resolve(opts.renderer ?? join(homedir(), 'Library/Application Support/com.oshi-connect.opensekai/renderer-output_main.json'));
    const suffix = randomUUID().slice(0, 8);
    const state = { sceneName: `OpenSekai-QA-${suffix}`, sourceName: `OpenSekai-QA-Renderer-${suffix}`, priorScene: (await call('GetCurrentProgramScene')).currentProgramSceneName, switched: false };
    mkdirSync(dirname(resolve(opts.state)), { recursive: true });
    writeFileSync(opts.state, JSON.stringify(state, null, 2));
    await call('CreateScene', { sceneName: state.sceneName });
    await call('CreateInput', { sceneName: state.sceneName, inputName: state.sourceName, inputKind: 'browser_source', inputSettings: { url: outputUrl(rendererFile), width: 1920, height: 1080, fps: 60, fps_custom: true, shutdown: false, restart_when_active: false }, sceneItemEnabled: true });
    if (opts.program) {
      await call('SetCurrentProgramScene', { sceneName: state.sceneName });
      state.switched = true;
    }
    writeFileSync(opts.state, JSON.stringify(state, null, 2));
    print(state);
  } else if (command === 'screenshot') {
    const state = readState();
    if (!opts.out) fail('Pass --out <png>.');
    const { imageData } = await call('GetSourceScreenshot', { sourceName: state.sourceName, imageFormat: 'png', imageWidth: Number(opts.width ?? 1920), imageHeight: Number(opts.height ?? 1080) });
    mkdirSync(dirname(resolve(opts.out)), { recursive: true });
    writeFileSync(opts.out, Buffer.from(imageData.replace(/^data:image\/png;base64,/, ''), 'base64'));
    print({ saved: resolve(opts.out) });
  } else if (command === 'stats') {
    const s = await call('GetStats');
    print({ activeFps: s.activeFps, renderSkippedFrames: s.renderSkippedFrames, renderTotalFrames: s.renderTotalFrames, outputSkippedFrames: s.outputSkippedFrames, outputTotalFrames: s.outputTotalFrames, averageFrameRenderTime: s.averageFrameRenderTime });
  } else if (command === 'teardown') {
    const state = readState();
    const problems = [];
    if (state.switched) await call('SetCurrentProgramScene', { sceneName: state.priorScene }).catch(error => problems.push(error.message));
    await call('RemoveInput', { inputName: state.sourceName }).catch(error => problems.push(error.message));
    await call('RemoveScene', { sceneName: state.sceneName }).catch(error => problems.push(error.message));
    rmSync(opts.state, { force: true });
    print({ restoredScene: state.switched ? state.priorScene : null, problems });
    if (problems.length) process.exitCode = 1;
  } else fail('Commands: status, setup, screenshot, stats, teardown.');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  socket.close();
}

function print(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
function fail(message) { process.stderr.write(message + '\n'); process.exit(1); }
