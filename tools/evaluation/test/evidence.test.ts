import { it, expect } from 'vitest';
import { tagId } from '@opensekai/contracts';
import { counterDelta, correlateMarker, verifyCaptureEvidence, sanitizedFailure } from '../src/rubric';
const counts = {
    renderSkippedFrames: 2, renderTotalFrames: 100, outputSkippedFrames: 0, outputTotalFrames: 0
};
it('reports counter reset as unknown', () => {
    expect(counterDelta(counts, {
        ...counts, renderTotalFrames: 1
    })).toBeNull();
    expect(counterDelta(counts, {
        ...counts, renderTotalFrames: 200
    })).toEqual({
        ...counts, renderSkippedFrames: 0, renderTotalFrames: 100
    });
});
it('rejects unrelated and stale source marker', () => {
    const expected = {
        sessionId: 'session', cameraId: 'camera', revision: 2, tick: 100, sequence: 100
    };
    const marker = {
        sessionTag: tagId('other'), cameraTag: tagId('camera'), revision: 2, tick: 100, sequence: 100
    };
    expect(correlateMarker(marker, expected, 100).result).toBe('fail');
    expect(correlateMarker({
        ...marker, sessionTag: tagId('session'), tick: 140, sequence: 140
    }, expected, 100).result).toBe('fail');
    expect(correlateMarker({
        ...marker, sessionTag: tagId('session')
    }, expected, 501).result).toBe('fail');
});
it('requires canonical matching capture evidence', () => {
    expect(verifyCaptureEvidence({
        id: 'cap', resourceUri: 'opensekai://evidence/cap/capture.png', sha256: 'a'.repeat(64), bytes: 100
    }, {
        id: 'cap', kind: 'capture', sessionId: 'session', fixtureId: 'smoke_v1', resources: [{
                uri: 'opensekai://evidence/other/capture.png', sha256: 'a'.repeat(64), bytes: 100, mimeType: 'image/png'
            }]
    }, 'session').result).toBe('fail');
});
it('sanitizes arbitrary failure details', () => expect(sanitizedFailure(new Error('secret http://127.0.0.1/ticket#token'))).toEqual({
    error: 'UNAVAILABLE'
}));
import { vi } from 'vitest';
import { PNG } from 'pngjs';
import { encodeMarker } from '@opensekai/contracts';
import type { AppApi, AppStatus, FrameApplied, CaptureRecord } from '@opensekai/contracts';
import { evaluateSmokeWithPorts } from '../src/run-smoke';
import type { ObsAdapter as EvaluationObsAdapter } from '../src/types';
function driverFixture(capabilities = ['read', 'capture', 'benchmark']) {
    let now = 0, active = false;
    const frame = () => ({
        outputId: 'output_main', sessionId: 'session', sequence: Math.floor(now * 0.06) + 1, tick: Math.floor(now * 0.06) + 1, revision: 0, cameraId: 'camera', backend: 'webgl2', cpuMs: 1, gpuMs: null, warnings: []
    } as FrameApplied);
    const descriptor = {
        schemaVersion: 1, sessionId: 'session', role: 'renderer', outputId: 'output_main', httpOrigin: 'http://127.0.0.1:9000', wsUrl: 'ws://127.0.0.1:9000/ws', token: 'never-log-this-ticket', capabilities: ['read']
    };
    const options = {
        profileId: 'webgl2_smoke_v1' as const, outputUrl: 'http://127.0.0.1:9000/renderer/?diagnostics=1&backend=webgl2#' + encodeURIComponent(JSON.stringify(descriptor)), destinationDir: '/tmp/mock-only', sceneName: 'mock-scene', sourceName: 'mock-source'
    };
    const status = () => ({
        schemaVersion: 1, sessionId: 'session', ready: true, revision: 0, capabilities, outputs: [{
                outputId: 'output_main', connected: true, lastFrame: frame()
            }]
    } as AppStatus);
    const api = {
        appStatus: vi.fn(async () => ({
            ok: true, data: status()
        })), captureFrame: vi.fn(async () => ({
            ok: true, data: {
                id: 'cap_' + now, outputId: 'output_main', revision: 0, tick: frame().tick, sequence: frame().sequence, backend: 'webgl2', cameraId: 'camera', width: 1920, height: 1080, mimeType: 'image/png', bytes: 100, sha256: 'a'.repeat(64), resourceUri: `opensekai://evidence/cap_${now}/capture.png`, createdAtUtc: '2026-10-03T00:00:00Z'
            }
        })), evidenceRead: vi.fn(async ({ evidenceId }: {
            evidenceId: string;
        }) => ({
            ok: true, data: {
                id: evidenceId, kind: 'capture', sessionId: 'session', fixtureId: 'smoke_v1', appCommit: 'abc', resources: [{
                        uri: `opensekai://evidence/${evidenceId}/capture.png`, mimeType: 'image/png', sha256: 'a'.repeat(64), bytes: 100
                    }]
            }
        })), benchmarkStart: vi.fn(async () => {
            active = true;
            return {
                ok: true, data: {
                    id: 'run', state: 'warming', progress: 0, summaryResourceUri: null, error: null
                }
            };
        }), benchmarkStatus: vi.fn(async () => {
            const state = now < 30000 ? 'warming' : now < 150000 ? 'measuring' : 'complete';
            if (state === 'complete')
                active = false;
            return {
                ok: true, data: {
                    id: 'run', state, progress: now / 150000, summaryResourceUri: null, error: null
                }
            };
        }), benchmarkCancel: vi.fn(async () => {
            active = false;
            return {
                ok: true, data: {
                    id: 'run', state: 'cancelled', progress: 0, summaryResourceUri: null, error: null
                }
            };
        })
    } as unknown as AppApi;
    const screenshots: number[] = [], stats: number[] = [], writes: string[] = [];
    const obs: EvaluationObsAdapter = {
        readVersions: async () => ({
            obs: '32', websocket: '5', availableRequests: []
        }), readVideo: async () => ({
            width: 1920, height: 1080, fps: 60
        }), readStats: async () => {
            stats.push(now);
            return {
                renderSkippedFrames: 0, renderTotalFrames: Math.floor(now * .06), outputSkippedFrames: 0, outputTotalFrames: 0
            };
        }, screenshot: async () => {
            screenshots.push(now);
            const png = new PNG({
                width: 336, height: 8
            });
            const current = frame();
            encodeMarker({
                sessionTag: tagId('session'), sequence: current.sequence, tick: current.tick, revision: 0, cameraTag: tagId('camera')
            }).forEach((bit, i) => {
                for (let y = 0; y < 8; y++)
                    for (let x = 0; x < 2; x++) {
                        const offset = (y * 336 + i * 2 + x) * 4;
                        png.data.fill(bit * 255, offset, offset + 3);
                        png.data[offset + 3] = 255;
                    }
            });
            return PNG.sync.write(png);
        }, withOwnedScene: async (options, action) => action({
            sceneName: options.sceneName, sourceName: options.sourceName
        }), disconnect: async () => {
        }
    };
    const ports = {
        now: () => now, sleep: async (ms: number) => {
            now += ms;
        }, write: async (_dir: string, name: string) => {
            writes.push(name);
        }
    };
    return {
        api, obs, options, ports, screenshots, stats, writes, isActive: () => active
    };
}
it('keeps screenshots outside 30s warmup plus 120s timing', async () => {
    const f = driverFixture();
    const report = await evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports);
    expect(f.stats).toEqual([30000, 150000]);
    expect(f.screenshots).toEqual([0, 151000, 152000, 153000, 154000]);
    expect(report.markers).toHaveLength(2);
    expect(report.checks.find(c => c.name === 'measurement-window')?.result).toBe('pass');
    expect(report.checks.find(c => c.name === 'tick-progression')?.result).toBe('pass');
    expect(JSON.stringify(report)).not.toContain('never-log-this-ticket');
    expect(f.writes).toContain('smoke-report.json');
});
it('rejects missing app capabilities before OBS setup', async () => {
    const f = driverFixture(['read']);
    const setup = vi.spyOn(f.obs, "withOwnedScene");
    await expect(evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports)).rejects.toMatchObject({
        code: 'FORBIDDEN'
    });
    expect(setup).not.toHaveBeenCalled();
});
it('cancels benchmark on timing failure', async () => {
    const f = driverFixture();
    f.obs.readStats = async () => {
        throw new Error('stats unavailable');
    };
    await expect(evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports)).rejects.toThrow('stats unavailable');
    expect(f.api.benchmarkCancel).toHaveBeenCalledWith({
        runId: 'run'
    });
    expect(f.isActive()).toBe(false);
});
import { summaryChecks } from '../src/run-smoke';
it('uses measured CPU threshold and keeps unmeasured maximum stall unknown', () => {
    const checks = summaryChecks({
        run: {
            id: 'run'
        }, fixtureId: 'smoke_v1', profileId: 'webgl2_smoke_v1', count: 100, cpuMs: {
            p95: 13
        }, intervalMs: {
            p99: 15
        }, gpuMs: null, staleOutputPeriods: 0
    }, 'webgl2_smoke_v1', {
        runId: 'run', sessionId: 'session'
    });
    expect(checks.find(c => c.name === 'cpu-p95')?.result).toBe('fail');
    expect(checks.find(c => c.name === 'maximum-stall')?.result).toBe('unknown');
});
it('rejects wrong backend and session before timing', async () => {
    const f = driverFixture();
    const status = await f.api.appStatus({});
    if (!status.ok)
        throw new Error('fixture');
    status.data.outputs[0].lastFrame!.backend = 'webgpu';
    vi.spyOn(f.api, 'appStatus').mockResolvedValue(status);
    await expect(evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports)).rejects.toMatchObject({
        code: 'CONFLICT'
    });
    expect(f.api.benchmarkStart).not.toHaveBeenCalled();
});
it('rejects a summary URI for another run', async () => {
    const f = driverFixture();
    const status = vi.mocked(f.api.benchmarkStatus).getMockImplementation()!;
    vi.spyOn(f.api, 'benchmarkStatus').mockImplementation(async (p) => {
        const reply = await status(p);
        if (reply.ok && reply.data.state === 'complete')
            reply.data.summaryResourceUri = 'opensekai://evidence/other/summary.json';
        return reply;
    });
    await expect(evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports)).rejects.toMatchObject({
        code: 'CONFLICT'
    });
});
it('rejects wrong manifest ID despite correct summary URI', async () => {
    const f = driverFixture();
    const status = vi.mocked(f.api.benchmarkStatus).getMockImplementation()!;
    vi.spyOn(f.api, 'benchmarkStatus').mockImplementation(async (p) => {
        const reply = await status(p);
        if (reply.ok && reply.data.state === 'complete')
            reply.data.summaryResourceUri = 'opensekai://evidence/run/summary.json';
        return reply;
    });
    const evidence = vi.mocked(f.api.evidenceRead).getMockImplementation()!;
    vi.spyOn(f.api, 'evidenceRead').mockImplementation(async (p) => p.evidenceId === 'run' ? {
        ok: true, data: {
            id: 'other', kind: 'benchmark', sessionId: 'session', fixtureId: 'smoke_v1', appCommit: 'abc', resources: [{
                    uri: 'opensekai://evidence/run/summary.json', sha256: 'a'.repeat(64), bytes: 100, mimeType: 'application/json'
                }]
        }
    } : evidence(p));
    await expect(evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports)).rejects.toMatchObject({
        code: 'CONFLICT'
    });
});
it('rejects wrong byte-summary run and session identity', () => {
    for (const summary of [{
            run: {
                id: 'other'
            }, sessionId: 'session'
        }, {
            run: {
                id: 'run'
            }, sessionId: 'other'
        }])
        expect(() => summaryChecks({
            ...summary, fixtureId: 'smoke_v1', profileId: 'webgl2_smoke_v1'
        }, 'webgl2_smoke_v1', {
            runId: 'run', sessionId: 'session'
        })).toThrow();
});
import { decodeMarker } from '../src/marker';
it('passes capture-anchored composition freshness and fails revision mismatch', async () => {
    const f = driverFixture();
    const screenshot = f.obs.screenshot;
    f.obs.screenshot = async (name) => {
        const bytes = await screenshot(name);
        if (!name.endsWith('_dark'))
            return bytes;
        const decoded = decodeMarker(bytes);
        if (!decoded.ok)
            throw new Error('fixture marker');
        const png = PNG.sync.read(Buffer.from(bytes));
        encodeMarker({
            ...decoded.data, revision: 99
        }).forEach((bit, i) => {
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 2; x++) {
                    const offset = (y * 336 + i * 2 + x) * 4;
                    png.data.fill(bit * 255, offset, offset + 3);
                    png.data[offset + 3] = 255;
                }
        });
        return PNG.sync.write(png);
    };
    const report = await evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports);
    expect(report.checks.find(c => c.name === 'composition-dark')?.result).toBe('fail');
    expect(report.checks.find(c => c.name === 'composition-light')?.result).toBe('pass');
    expect(f.screenshots).toHaveLength(5);
});
it('accepts matching run metadata and rejects an oversized run ID', () => {
    const value = {
        run: {
            id: 'run'
        }, fixtureId: 'smoke_v1', profileId: 'webgl2_smoke_v1', count: 1, cpuMs: {
            p95: 1
        }, staleOutputPeriods: 0
    };
    expect(summaryChecks(value, 'webgl2_smoke_v1', {
        runId: 'run', sessionId: 'session'
    }).find(c => c.name === 'cpu-p95')?.result).toBe('pass');
    const id = 'a'.repeat(129);
    expect(() => summaryChecks({
        ...value, run: {
            id
        }
    }, 'webgl2_smoke_v1', {
        runId: id, sessionId: 'session'
    })).toThrow();
});
import * as driver from '../src/run-smoke';
it('accepts explicit CLI profile and repeats before requesting descriptor paths', async () => {
    await expect(driver.runCli({}, ['--profile', 'webgpu_smoke_v1', '--repeats', '3'])).rejects.toMatchObject({
        code: 'INVALID_INPUT', message: 'Explicit descriptor and evidence paths required'
    });
});
it('validates CLI/env profile agreement and rejects invalid fields', () => {
    expect(driver.parseCliOptions(undefined, ['--profile', 'webgpu_smoke_v1', '--repeats', '3'])).toEqual({
        profileId: 'webgpu_smoke_v1', repeats: 3
    });
    expect(driver.parseCliOptions('webgl2_smoke_v1', ['--repeats', '1', '--profile', 'webgl2_smoke_v1'])).toEqual({
        profileId: 'webgl2_smoke_v1', repeats: 1
    });
    expect(driver.parseCliOptions('webgpu_smoke_v1', [])).toEqual({
        profileId: 'webgpu_smoke_v1', repeats: 1
    });
    for (const [env, args] of [[undefined, []], ['webgpu_smoke_v1', ['--profile', 'webgl2_smoke_v1']], [undefined, ['--profile', 'invalid']], [undefined, ['--profile']], [undefined, ['--profile', 'webgpu_smoke_v1', '--repeats', '2']], [undefined, ['--profile', 'webgpu_smoke_v1', '--profile', 'webgpu_smoke_v1']], [undefined, ['--profile', 'webgpu_smoke_v1', '--unknown', '1']], ['invalid', ['--profile', 'webgpu_smoke_v1']]] as [
        string | undefined,
        string[]
    ][])
        expect(() => driver.parseCliOptions(env, args)).toThrow();
});
it('gates the measured native maximum interval without p99 substitution', () => {
    const value = {
        run: {
            id: 'run'
        }, fixtureId: 'smoke_v1', profileId: 'webgl2_smoke_v1'
    };
    for (const [maximum, result] of [[0, 'pass'], [100, 'pass'], [100.1, 'fail'], [undefined, 'unknown'], [-1, 'unknown'], [NaN, 'unknown'], [Infinity, 'unknown']] as [
        number | undefined,
        string
    ][]) {
        const checks = summaryChecks({
            ...value, intervalMs: {
                max: maximum, p99: 1
            }
        }, 'webgl2_smoke_v1', {
            runId: 'run', sessionId: 'session'
        });
        expect(checks.find(c => c.name === 'maximum-stall')?.result).toBe(result);
    }
});
it('reports delayed OBS window as unknown separately from native policy', async () => {
    const f = driverFixture();
    const status = vi.mocked(f.api.benchmarkStatus).getMockImplementation()!;
    vi.spyOn(f.api, 'benchmarkStatus').mockImplementation(async (p) => {
        const reply = await status(p);
        if (reply.ok && reply.data.state === 'measuring' && reply.data.progress === 0.2)
            reply.data.state = 'warming';
        return reply;
    });
    const report = await evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports);
    expect(f.stats).toEqual([31000, 150000]);
    const window = report.checks.find(c => c.name === 'measurement-window')!;
    expect(window.result).toBe('unknown');
    expect(window.detail).toContain('119000');
    expect(window.detail).toContain('native');
});

it('anchors all compositions to fresh rate-limited captures after timing despite newer status ACKs', async () => {
    const f = driverFixture();
    const status = vi.mocked(f.api.appStatus).getMockImplementation()!;
    vi.mocked(f.api.appStatus).mockImplementation(async (p) => {
        const reply = await status(p);
        if (reply.ok) {
            reply.data.outputs[0].lastFrame!.tick += 100;
            reply.data.outputs[0].lastFrame!.sequence += 100;
        }
        return reply;
    });
    const capture = vi.mocked(f.api.captureFrame).getMockImplementation()!;
    const times: number[] = [];
    vi.mocked(f.api.captureFrame).mockImplementation(async (p) => {
        times.push(f.ports.now());
        expect(f.isActive()).toBe(false);
        return capture(p);
    });
    const report = await evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports);
    expect(times).toEqual([0, 151000, 152000, 153000, 154000]);
    expect(f.stats).toEqual([30000, 150000]);
    expect(report.appEvidenceIds).toEqual(times.map(t => 'cap_' + t));
    expect(f.api.captureFrame).toHaveBeenCalledTimes(5);
    for (const [request] of vi.mocked(f.api.captureFrame).mock.calls)
        expect(request).toEqual({ outputId: 'output_main', expectedRevision: 0, preset: 'diagnostic_v1', maxAgeMs: 500 });
    for (const background of ['dark', 'light', 'checker'])
        expect(report.checks.find(c => c.name === 'composition-' + background)?.result).toBe('pass');
});
it('fails composition evidence with wrong capture ID, session, hash or bytes despite a valid marker', async () => {
    for (const field of ['id', 'sessionId', 'uri', 'sha256', 'bytes']) {
        const f = driverFixture();
        const evidence = vi.mocked(f.api.evidenceRead).getMockImplementation()!;
        vi.mocked(f.api.evidenceRead).mockImplementation(async (p) => {
            const reply = await evidence(p);
            if (reply.ok && p.evidenceId === 'cap_152000') {
                if (field === 'id' || field === 'sessionId') reply.data[field] = 'other';
                else if (field === 'bytes') reply.data.resources[0].bytes += 1;
                else reply.data.resources[0][field as 'uri' | 'sha256'] = field === 'uri' ? 'opensekai://evidence/other/capture.png' : 'b'.repeat(64);
            }
            return reply;
        });
        const report = await evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports);
        expect(report.checks.filter(c => c.name === 'capture-evidence').map(c => c.result)).toEqual(['pass', 'pass', 'fail', 'pass', 'pass']);
        expect(report.checks.find(c => c.name === 'composition-dark')?.result).toBe('fail');
    }
});
it('rejects composition capture scope changes before screenshot', async () => {
    for (const changed of [{ outputId: 'other' }, { revision: 99 }, { cameraId: 'other' }, { backend: 'webgpu' }]) {
        const f = driverFixture();
        const capture = vi.mocked(f.api.captureFrame).getMockImplementation()!;
        vi.mocked(f.api.captureFrame).mockImplementation(async (p) => {
            const reply = await capture(p);
            if (reply.ok && f.ports.now() >= 152000) Object.assign(reply.data, changed);
            return reply;
        });
        await expect(evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports)).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(f.screenshots).toEqual([0, 151000]);
    }
});
it('fails a composition capture-to-screenshot interval above 500ms', async () => {
    const f = driverFixture();
    const screenshot = f.obs.screenshot;
    f.obs.screenshot = async name => {
        if (name.endsWith('_dark')) await f.ports.sleep(501);
        return screenshot(name);
    };
    const report = await evaluateSmokeWithPorts(f.api, f.obs, f.options, f.ports);
    expect(report.checks.find(c => c.name === 'composition-dark')?.result).toBe('fail');
    expect(report.checks.find(c => c.name === 'composition-light')?.result).toBe('pass');
});

it('keeps the inclusive 30-tick and 500ms correlation bounds', () => {
    const expected = { sessionId: 'session', cameraId: 'camera', revision: 2, tick: 100, sequence: 100 };
    const marker = { sessionTag: tagId('session'), cameraTag: tagId('camera'), revision: 2, tick: 130, sequence: 130 };
    expect(correlateMarker(marker, expected, 500).result).toBe('pass');
    expect(correlateMarker({ ...marker, tick: 131 }, expected, 500).result).toBe('fail');
    expect(correlateMarker({ ...marker, sequence: 131 }, expected, 500).result).toBe('fail');
    expect(correlateMarker({ ...marker, tick: 99 }, expected, 500).result).toBe('fail');
    expect(correlateMarker(marker, expected, 501).result).toBe('fail');
});
