import OBSWebSocket from 'obs-websocket-js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type { ObsAdapter, ObsCounters, SmokeOptions } from './types';
import { inspectPng } from './marker';
import { evaluationError } from './rubric';
export const REQUIRED_REQUESTS = ['GetVersion', 'GetVideoSettings', 'GetStats', 'GetSourceScreenshot', 'GetStreamStatus', 'GetRecordStatus', 'GetCurrentProgramScene', 'SetCurrentProgramScene', 'GetSceneList', 'GetInputList', 'CreateScene', 'RemoveScene', 'CreateInput', 'RemoveInput', 'CreateSceneItem'] as const;
export interface ObsTransport {
    call(method: string, params?: Record<string, unknown>): Promise<any>;
    disconnect(): Promise<void>;
}
export async function connectObs(url: string): Promise<ObsAdapter> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    }
    catch {
        throw evaluationError('INVALID_INPUT', 'OBS URL invalid');
    }
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash)
        throw evaluationError('INVALID_INPUT', 'OBS must use a local credential-free endpoint');
    const socket = new OBSWebSocket();
    try {
        await bounded(socket.connect(url), 5000);
        return await createObsAdapter(socket as unknown as ObsTransport);
    }
    catch (error) {
        await socket.disconnect().catch(() => {
        });
        if ((error as {
            code?: string;
        })?.code === 'FORBIDDEN')
            throw evaluationError('FORBIDDEN', 'OBS authentication required');
        if ((error as {
            code?: string;
        })?.code === 'UNSUPPORTED')
            throw evaluationError('UNSUPPORTED', 'Required OBS request unavailable');
        throw evaluationError('UNAVAILABLE', 'OBS connection unavailable');
    }
}
function bounded<T>(operation: Promise<T>, ms = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(evaluationError('TIMEOUT', 'OBS request timed out')), ms);
        operation.then(value => {
            clearTimeout(timer);
            resolve(value);
        }, error => {
            clearTimeout(timer);
            reject(evaluationError(error?.code === 4009 ? 'FORBIDDEN' : 'UNAVAILABLE', 'OBS request failed'));
        });
    });
}
export async function createObsAdapter(transport: ObsTransport): Promise<ObsAdapter> {
    const call = (method: string, params?: Record<string, unknown>) => bounded(transport.call(method, params));
    const version = await call('GetVersion');
    if (!Array.isArray(version.availableRequests) || REQUIRED_REQUESTS.some(request => !version.availableRequests.includes(request)))
        throw evaluationError('UNSUPPORTED', 'Required OBS request unavailable');
    const idle = async () => {
        const [stream, record] = await Promise.all([call('GetStreamStatus'), call('GetRecordStatus')]);
        if (stream.outputActive !== false || record.outputActive !== false)
            throw evaluationError('BUSY', 'OBS must be idle');
    };
    const readVideo = async () => {
        const v = await call('GetVideoSettings');
        if (!Number.isFinite(v.fpsNumerator) || !Number.isFinite(v.fpsDenominator) || v.fpsDenominator <= 0)
            throw evaluationError('INVALID_INPUT', 'OBS video settings invalid');
        return {
            width: v.baseWidth, height: v.baseHeight, fps: v.fpsNumerator / v.fpsDenominator
        };
    };
    let busy = false;
    return {
        readVersions: async () => ({
            obs: version.obsVersion, websocket: version.obsWebSocketVersion, availableRequests: [...version.availableRequests]
        }),
        readVideo,
        readStats: async () => {
            const s = await call('GetStats');
            const counters: ObsCounters = {
                renderSkippedFrames: s.renderSkippedFrames, renderTotalFrames: s.renderTotalFrames, outputSkippedFrames: s.outputSkippedFrames, outputTotalFrames: s.outputTotalFrames
            };
            if (Object.values(counters).some(value => !Number.isSafeInteger(value) || value < 0))
                throw evaluationError('INVALID_INPUT', 'OBS counters invalid');
            return counters;
        },
        screenshot: async (sourceName) => {
            const result = await call('GetSourceScreenshot', {
                sourceName, imageFormat: 'png', imageWidth: 1920, imageHeight: 1080
            });
            const prefix = 'data:image/png;base64,';
            if (typeof result.imageData !== 'string' || !result.imageData.startsWith(prefix) || result.imageData.length > prefix.length + Math.ceil(2 * 1024 * 1024 / 3) * 4)
                throw evaluationError('INVALID_INPUT', 'OBS screenshot exceeds PNG budget');
            const base64 = result.imageData.slice(prefix.length);
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4)
                throw evaluationError('INVALID_INPUT', 'OBS PNG encoding invalid');
            const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
            try {
                inspectPng(bytes);
            }
            catch {
                throw evaluationError('INVALID_INPUT', 'OBS PNG invalid');
            }
            return bytes;
        },
        async withOwnedScene(options, action) {
            if (busy)
                throw evaluationError('BUSY', 'OBS evaluation already active');
            busy = true;
            const scenes: string[] = [], inputs: string[] = [];
            let prior: string | undefined, switched = false, temp: string | undefined;
            try {
                await idle();
                const current = await call('GetCurrentProgramScene');
                prior = current.currentProgramSceneName;
                if (typeof prior !== 'string' || !prior)
                    throw evaluationError('INVALID_INPUT', 'OBS prior scene unavailable');
                const suffix = randomUUID();
                const sceneName = `${options.sceneName.slice(0, 80)}-${suffix}`, sourceName = `${options.sourceName.slice(0, 80)}-${suffix}`;
                const [existingScenes, existingInputs] = await Promise.all([call('GetSceneList'), call('GetInputList')]);
                if (existingScenes.scenes?.some((x: {
                    sceneName: string;
                }) => x.sceneName === sceneName) || existingInputs.inputs?.some((x: {
                    inputName: string;
                }) => x.inputName === sourceName))
                    throw evaluationError('CONFLICT', 'Owned OBS name collision');
                const video = await readVideo();
                if (video.width !== 1920 || video.height !== 1080 || video.fps !== 60)
                    throw evaluationError('UNSUPPORTED', 'OBS smoke requires 1920x1080 at 60 FPS');
                await call('CreateScene', {
                    sceneName
                });
                scenes.push(sceneName);
                await call('CreateInput', {
                    sceneName, inputName: sourceName, inputKind: 'browser_source', inputSettings: {
                        url: options.outputUrl, width: 1920, height: 1080, fps: 60, fps_custom: true, shutdown: false, restart_when_active: false
                    }, sceneItemEnabled: true
                });
                inputs.push(sourceName);
                temp = await mkdtemp(join(tmpdir(), 'opensekai-obs-'));
                for (const background of ['dark', 'light', 'checker'] as const) {
                    const composition = `${sceneName}_${background}`, inputName = `${sourceName}_${background}`;
                    await call('CreateScene', {
                        sceneName: composition
                    });
                    scenes.push(composition);
                    const path = join(temp, background + '.png');
                    await writeFile(path, backgroundPng(background));
                    await call('CreateInput', {
                        sceneName: composition, inputName, inputKind: 'image_source', inputSettings: {
                            file: path
                        }, sceneItemEnabled: true
                    });
                    inputs.push(inputName);
                    await call('CreateSceneItem', {
                        sceneName: composition, sourceName, sceneItemEnabled: true
                    });
                }
                await idle();
                await call('SetCurrentProgramScene', {
                    sceneName
                });
                switched = true;
                return await action({
                    sceneName, sourceName
                });
            }
            finally {
                const failures: unknown[] = [];
                if (switched && prior)
                    try {
                        await call('SetCurrentProgramScene', {
                            sceneName: prior
                        });
                    }
                    catch (error) {
                        failures.push(error);
                    }
                for (const inputName of inputs.reverse())
                    try {
                        await call('RemoveInput', {
                            inputName
                        });
                    }
                    catch (error) {
                        failures.push(error);
                    }
                for (const sceneName of scenes.reverse())
                    try {
                        await call('RemoveScene', {
                            sceneName
                        });
                    }
                    catch (error) {
                        failures.push(error);
                    }
                if (temp)
                    try {
                        await rm(temp, {
                            recursive: true, force: true
                        });
                    }
                    catch (error) {
                        failures.push(error);
                    }
                busy = false;
                if (failures.length)
                    throw evaluationError('UNAVAILABLE', 'OBS cleanup incomplete');
            }
        },
        disconnect: () => transport.disconnect()
    };
}
function backgroundPng(kind: 'dark' | 'light' | 'checker'): Buffer {
    const png = new PNG({
        width: 1920, height: 1080
    });
    for (let y = 0; y < 1080; y++)
        for (let x = 0; x < 1920; x++) {
            const value = kind === 'dark' ? 24 : kind === 'light' ? 240 : (Math.floor(x / 32) + Math.floor(y / 32)) % 2 ? 80 : 200;
            const offset = (y * 1920 + x) * 4;
            png.data.fill(value, offset, offset + 3);
            png.data[offset + 3] = 255;
        }
    return PNG.sync.write(png);
}
