import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionDescriptorSchema } from '@opensekai/contracts';
import type { AppApi, ConnectionDescriptor, Reply } from '@opensekai/contracts';
import { connectClient } from '@opensekai/browser-client';
import { connectObs } from './obs';
import { decodeMarker } from './marker';
import { correlateMarker, counterDelta, evaluationError, sanitizedFailure, skippedFrameCheck, verifyCaptureEvidence } from './rubric';
import type { ObsAdapter, SmokeOptions, SmokeReport } from './types';
export interface EvaluationPorts {
    now(): number;
    sleep(ms: number): Promise<void>;
    write(destination: string, name: string, bytes: Uint8Array): Promise<void>;
}
const ports: EvaluationPorts = {
    now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), write: async (destination, name, bytes) => {
        await mkdir(destination, {
            recursive: true
        });
        await writeFile(join(destination, name), bytes);
    }
};
function unwrap<T>(reply: Reply<T>): T {
    if (!reply.ok)
        throw evaluationError(reply.error.code, 'App evaluation request failed');
    return reply.data;
}
export function rendererDescriptor(outputUrl: string): ConnectionDescriptor {
    try {
        const url = new URL(outputUrl);
        const descriptor = ConnectionDescriptorSchema.parse(JSON.parse(decodeURIComponent(url.hash.slice(1))));
        if (descriptor.role !== 'renderer' || !descriptor.outputId || url.origin !== new URL(descriptor.httpOrigin).origin || url.pathname !== '/renderer/' || url.username || url.password)
            throw new Error('scope');
        return descriptor;
    }
    catch {
        throw evaluationError('INVALID_INPUT', 'Renderer output descriptor invalid');
    }
}
export async function evaluateSmoke(api: AppApi, obs: ObsAdapter, options: SmokeOptions): Promise<SmokeReport> {
    return evaluateSmokeWithPorts(api, obs, options, ports);
}
export async function evaluateSmokeWithPorts(api: AppApi, obs: ObsAdapter, options: SmokeOptions, p: EvaluationPorts): Promise<SmokeReport> {
    const descriptor = rendererDescriptor(options.outputUrl);
    if (!['webgpu_smoke_v1', 'webgl2_smoke_v1'].includes(options.profileId))
        throw evaluationError('INVALID_INPUT', 'Smoke profile invalid');
    const initial = unwrap(await api.appStatus({}));
    if (initial.sessionId !== descriptor.sessionId)
        throw evaluationError('CONFLICT', 'App and renderer sessions differ');
    if (!['read', 'capture', 'benchmark'].every(capability => initial.capabilities.includes(capability as 'read' | 'capture' | 'benchmark')))
        throw evaluationError('FORBIDDEN', 'Evaluation capabilities required');
    const version = await obs.readVersions(), video = await obs.readVideo();
    if (video.width !== 1920 || video.height !== 1080 || video.fps !== 60)
        throw evaluationError('UNSUPPORTED', 'OBS smoke video profile differs');
    const report: SmokeReport = {
        runId: '', appEvidenceIds: [], obsCaptureHashes: [], checks: [{
                name: 'obs-version', result: 'pass', detail: `OBS ${version.obs}; WebSocket ${version.websocket}`
            }], counterDelta: null, markers: []
    };
    const expectedBackend = options.profileId === 'webgpu_smoke_v1' ? 'webgpu' : 'webgl2';
    let activeRun: string | null = null;
    const getOutput = async () => {
        const status = unwrap(await api.appStatus({}));
        if (status.sessionId !== descriptor.sessionId)
            throw evaluationError('CONFLICT', 'App session changed');
        const output = status.outputs.find(item => item.outputId === descriptor.outputId);
        if (!output?.connected || !output.lastFrame)
            throw evaluationError('UNAVAILABLE', 'Current renderer output unavailable');
        if (output.lastFrame.backend !== expectedBackend)
            throw evaluationError('CONFLICT', 'Renderer backend differs from profile');
        return output.lastFrame;
    };
    const rawCapture = async (sourceName: string) => {
        const frame = await getOutput();
        const started = p.now();
        const capture = unwrap(await api.captureFrame({
            outputId: frame.outputId, expectedRevision: frame.revision, preset: 'diagnostic_v1', maxAgeMs: 500
        }));
        if (capture.outputId !== frame.outputId || capture.cameraId !== frame.cameraId || capture.revision !== frame.revision || capture.backend !== frame.backend)
            throw evaluationError('CONFLICT', 'App capture scope differs');
        const manifest = unwrap(await api.evidenceRead({
            evidenceId: capture.id
        }));
        report.checks.push(verifyCaptureEvidence(capture, manifest, descriptor.sessionId));
        report.appEvidenceIds.push(capture.id);
        const png = await obs.screenshot(sourceName);
        const elapsed = p.now() - started;
        const marker = decodeMarker(png);
        if (marker.ok) {
            report.markers.push(marker.data);
            report.checks.push(correlateMarker(marker.data, {
                ...capture, sessionId: descriptor.sessionId
            }, elapsed));
        }
        else
            report.checks.push({
                name: 'marker-correlation', result: 'fail', detail: 'OBS source has no valid diagnostic marker'
            });
        const hash = createHash('sha256').update(png).digest('hex');
        report.obsCaptureHashes.push(hash);
        await p.write(options.destinationDir, hash + '.png', png);
    };
    try {
        return await obs.withOwnedScene(options, async (owned) => {
            const readyDeadline = p.now() + 2000;
            while (true) {
                try {
                    await getOutput();
                    break;
                }
                catch (error) {
                    if (p.now() >= readyDeadline || (error as {
                        code?: string;
                    }).code === 'CONFLICT')
                        throw error;
                    await p.sleep(100);
                }
            }
            await rawCapture(owned.sourceName);
            let run = unwrap(await api.benchmarkStart({
                requestId: randomUUID(), fixtureId: 'smoke_v1', profileId: options.profileId
            }));
            report.runId = run.id;
            activeRun = run.id;
            const deadline = p.now() + 160000;
            while (run.state === 'warming') {
                if (p.now() >= deadline)
                    throw evaluationError('TIMEOUT', 'Benchmark warmup timed out');
                await p.sleep(1000);
                run = unwrap(await api.benchmarkStatus({
                    runId: run.id
                }));
            }
            if (run.state !== 'measuring')
                throw evaluationError('UNAVAILABLE', 'Benchmark did not enter measurement');
            const before = await obs.readStats();
            const measurementStart = p.now();
            while (run.state === 'measuring') {
                if (p.now() >= deadline)
                    throw evaluationError('TIMEOUT', 'Benchmark measurement timed out');
                await p.sleep(1000);
                run = unwrap(await api.benchmarkStatus({
                    runId: run.id
                }));
            }
            const after = await obs.readStats();
            const measurementMs = p.now() - measurementStart;
            if (run.state !== 'complete')
                throw evaluationError(run.state === 'cancelled' ? 'CANCELLED' : 'UNAVAILABLE', 'Benchmark was not completed');
            activeRun = null;
            report.counterDelta = counterDelta(before, after);
            report.checks.push(skippedFrameCheck(report.counterDelta));
            report.checks.push({
                name: 'measurement-window', result: measurementMs >= 120000 && measurementMs <= 121500 ? 'pass' : 'unknown', detail: `OBS counters sampled for ${Math.round(measurementMs)} ms without screenshots`
            });
            report.checks.push({
                name: 'gpu-timing', result: 'unknown', detail: 'GPU timing requires native summary; unavailable values are not zero'
            });
            report.checks.push({
                name: 'encoder', result: 'unknown', detail: 'No recording phase was run'
            });
            report.checks.push({
                name: 'minimized-continuity', result: 'unknown', detail: 'Requires separate real OBS minimized recording evidence'
            });
            report.checks.push({
                name: 'alpha-visual-review', result: 'unknown', detail: 'Dark, light and checker captures require visual inspection'
            });
            if (run.summaryResourceUri) {
                const match = /^opensekai:\/\/evidence\/([A-Za-z0-9_-]+)\/summary\.json$/.exec(run.summaryResourceUri);
                if (!match)
                    throw evaluationError('INVALID_INPUT', 'Summary resource URI invalid');
                const summary = unwrap(await api.evidenceRead({
                    evidenceId: match[1]
                }));
                const resource = summary.resources.find(item => item.uri === run.summaryResourceUri);
                const valid = summary.kind === 'benchmark' && summary.sessionId === descriptor.sessionId && summary.fixtureId === 'smoke_v1' && resource?.mimeType === 'application/json' && /^[a-f0-9]{64}$/.test(resource.sha256) && resource.bytes > 0;
                report.checks.push({
                    name: 'benchmark-evidence', result: valid ? 'pass' : 'fail', detail: valid ? 'Registered benchmark summary present' : 'Benchmark evidence metadata differs'
                });
                report.appEvidenceIds.push(match[1]);
            }
            else
                report.checks.push({
                    name: 'benchmark-evidence', result: 'unknown', detail: 'No summary resource was returned'
                });
            await p.sleep(1000);
            await rawCapture(owned.sourceName);
            if (report.markers.length >= 2) {
                const [first, last] = [report.markers[0], report.markers.at(-1)!];
                report.checks.push({
                    name: 'tick-progression', result: last.sessionTag === first.sessionTag && last.tick > first.tick && last.sequence > first.sequence ? 'pass' : 'fail', detail: 'Compare displayed markers before and after timing; minimized continuity remains a separate gate'
                });
            }
            for (const background of ['dark', 'light', 'checker']) {
                const png = await obs.screenshot(`${owned.sceneName}_${background}`);
                const marker = decodeMarker(png);
                const valid = marker.ok && marker.data.sessionTag === report.markers.at(-1)?.sessionTag;
                report.checks.push({
                    name: `composition-${background}`, result: valid ? 'pass' : 'fail', detail: 'Composed OBS PNG collected; visual alpha review is pending'
                });
                const hash = createHash('sha256').update(png).digest('hex');
                report.obsCaptureHashes.push(hash);
                await p.write(options.destinationDir, hash + '.png', png);
            }
            await p.write(options.destinationDir, 'smoke-report.json', new TextEncoder().encode(JSON.stringify(report, null, 2) + '\n'));
            return report;
        });
    }
    finally {
        if (activeRun)
            unwrap(await api.benchmarkCancel({
                runId: activeRun
            }));
    }
}
export async function runCli(env: NodeJS.ProcessEnv = process.env, args: string[] = process.argv.slice(2)): Promise<SmokeReport[]> {
    const repeats = args.length === 0 ? 1 : args.length === 2 && args[0] === '--repeats' && ['1', '3'].includes(args[1]) ? Number(args[1]) : null;
    if (repeats === null)
        throw evaluationError('INVALID_INPUT', 'Use --repeats 1 or --repeats 3');
    const operatorPath = env.OPENSEKAI_CONNECTION_FILE, rendererPath = env.OPENSEKAI_RENDERER_CONNECTION_FILE, destination = env.OPENSEKAI_EVIDENCE_DIR;
    if (!operatorPath || !rendererPath || !destination)
        throw evaluationError('INVALID_INPUT', 'Explicit descriptor and evidence paths required');
    let operator: ConnectionDescriptor, renderer: ConnectionDescriptor;
    try {
        operator = ConnectionDescriptorSchema.parse(JSON.parse(await readFile(operatorPath, 'utf8')));
        renderer = ConnectionDescriptorSchema.parse(JSON.parse(await readFile(rendererPath, 'utf8')));
    }
    catch {
        throw evaluationError('INVALID_INPUT', 'Connection descriptor invalid');
    }
    if (operator.role !== 'operator' || renderer.role !== 'renderer' || !renderer.outputId || operator.sessionId !== renderer.sessionId)
        throw evaluationError('CONFLICT', 'Descriptor roles or sessions differ');
    if (!['read', 'capture', 'benchmark'].every(capability => operator.capabilities.includes(capability as 'read' | 'capture' | 'benchmark')))
        throw evaluationError('FORBIDDEN', 'Operator evaluation capabilities required');
    const profileId = env.OPENSEKAI_PROFILE === 'webgpu_smoke_v1' ? 'webgpu_smoke_v1' : env.OPENSEKAI_PROFILE === 'webgl2_smoke_v1' ? 'webgl2_smoke_v1' : null;
    if (!profileId)
        throw evaluationError('INVALID_INPUT', 'Explicit smoke profile required');
    const outputUrl = `${new URL(renderer.httpOrigin).origin}/renderer/?diagnostics=1${profileId === 'webgl2_smoke_v1' ? '&backend=webgl2' : ''}#${encodeURIComponent(JSON.stringify(renderer))}`;
    let obs: ObsAdapter | undefined;
    const client = await connectClient(operator);
    const reports: SmokeReport[] = [];
    try {
        obs = await connectObs(env.OPENSEKAI_OBS_URL ?? 'ws://127.0.0.1:4455');
        for (let repeat = 0; repeat < repeats; repeat++) {
            const runDestination = join(resolve(destination), profileId, randomUUID());
            const report = await evaluateSmoke(client.api, obs, {
                profileId, outputUrl, destinationDir: runDestination, sceneName: 'OpenSekai-Smoke', sourceName: 'OpenSekai-Renderer'
            });
            for (const id of [...new Set(report.appEvidenceIds)]) {
                const manifest = unwrap(await client.api.evidenceRead({
                    evidenceId: id
                }));
                if (manifest.sessionId !== operator.sessionId || manifest.resources.length !== 1)
                    throw evaluationError('CONFLICT', 'Evidence scope differs');
                for (const resource of manifest.resources) {
                    const match = /^opensekai:\/\/evidence\/([A-Za-z0-9_-]+)\/(capture\.png|summary\.json)$/.exec(resource.uri);
                    if (!match || match[1] !== id || resource.bytes <= 0 || resource.bytes > 2 * 1024 * 1024)
                        throw evaluationError('INVALID_INPUT', 'Evidence byte budget invalid');
                    const bytes = await client.readResource(resource.uri);
                    if (bytes.length !== resource.bytes || bytes.length > 2 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== resource.sha256)
                        throw evaluationError('INVALID_INPUT', 'Evidence byte hash differs');
                    if (match[2] === 'summary.json')
                        report.checks.push(...summaryChecks(JSON.parse(new TextDecoder().decode(bytes)), profileId));
                    await ports.write(runDestination, id + '-' + match[2], bytes);
                }
            }
            await ports.write(runDestination, 'smoke-report.json', new TextEncoder().encode(JSON.stringify(report, null, 2) + '\n'));
            reports.push(report);
        }
        return reports;
    }
    finally {
        client.close();
        await obs?.disconnect();
    }
}
export function summaryChecks(value: unknown, profileId: SmokeOptions['profileId']): SmokeReport['checks'] {
    const summary = value as {
        fixtureId?: string;
        profileId?: string;
        count?: number;
        cpuMs?: {
            p95?: number;
        } | null;
        gpuMs?: unknown;
        staleOutputPeriods?: number;
        resourceWarningCount?: number;
    };
    if (!summary || summary.fixtureId !== 'smoke_v1' || summary.profileId !== profileId)
        throw evaluationError('CONFLICT', 'Benchmark summary fixture or profile differs');
    const p95 = summary.cpuMs?.p95;
    const cpuKnown = typeof p95 === 'number' && Number.isFinite(p95) && p95 >= 0 && typeof summary.count === 'number' && summary.count > 0;
    return [
        {
            name: 'cpu-p95', result: cpuKnown ? (p95 < 12 ? 'pass' : 'fail') : 'unknown', detail: cpuKnown ? `Native ACK CPU p95 ${p95} ms` : 'CPU percentile unavailable'
        },
        {
            name: 'stale-output', result: typeof summary.staleOutputPeriods === 'number' ? (summary.staleOutputPeriods === 0 ? 'pass' : 'fail') : 'unknown', detail: 'Native ACK freshness gate; actual OBS minimized continuity remains separate'
        },
        {
            name: 'maximum-stall', result: 'unknown', detail: 'Interval p99 does not establish the maximum stall; maximum interval is not supplied'
        },
        {
            name: 'resource-warnings', result: 'unknown', detail: `Native warnings ${typeof summary.resourceWarningCount === 'number' ? summary.resourceWarningCount : 'unavailable'}; inspect documented unsupported features`
        }
    ];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runCli().then(reports => {
        console.log(JSON.stringify({
            reports
        }));
        if (reports.some(report => report.checks.some(check => check.result === 'fail')))
            process.exitCode = 1;
    }, error => {
        console.error(JSON.stringify(sanitizedFailure(error)));
        process.exitCode = 1;
    });
}
