#!/usr/bin/env node
// Sample the frame cost of one output (FrameApplied.cpuMs and gpuMs) from MCP app_status, with one MCP connection.
// It follows docs/evaluation/spring-bones/cost-sample.mjs and adds gpuMs. A null gpuMs is unknown and is not a sample.
// Usage (repository root, app running): node docs/evaluation/snow/cost-sample.mjs <label> [warmupS=30] [measureS=120] [output=output_main]
// It prints one JSON line: label, samples (distinct frames), cpuMs and gpuMs percentiles, the count of null gpuMs,
// the acknowledged frames for each second (from the sequence numbers), backend, and qualityProfile.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [label = 'run', warmupS = '30', measureS = '120', output = 'output_main'] = process.argv.slice(2);
const descriptor = join(homedir(), 'Library/Application Support/com.oshi-connect.opensekai/operator.json');
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp/src/cli.ts'], { env: { ...process.env, OPENSEKAI_CONNECTION_FILE: descriptor }, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let buffer = '', nextId = 1;
child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) !== -1;) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        pending.get(message.id)?.(message); pending.delete(message.id);
    }
});
const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const request = (method, params) => new Promise((settle, reject) => {
    const id = nextId++;
    pending.set(id, message => message.error ? reject(new Error(JSON.stringify(message.error))) : settle(message.result));
    send({ id, method, params });
});
const status = async () => JSON.parse((await request('tools/call', { name: 'app_status', arguments: {} })).content[0].text).data;
const wait = ms => new Promise(settle => setTimeout(settle, ms));
const round = value => value === undefined || Number.isNaN(value) ? 'unknown' : Math.round(value * 1000) / 1000;
const summary = values => {
    if (values.length === 0) return 'unknown';
    const sorted = [...values].sort((a, b) => a - b), at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), p50: round(at(.5)), p95: round(at(.95)), max: round(sorted.at(-1)) };
};

await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'snow-cost', version: '1.0.0' } });
send({ method: 'notifications/initialized' });
await wait(Number(warmupS) * 1000);
// Keyed by sequence: a poll that sees the same frame again does not count it twice.
const frames = new Map(), warnings = new Set();
const start = Date.now(), end = start + Number(measureS) * 1000;
let first, last;
while (Date.now() < end) {
    const data = await status(), frame = data.outputs?.find(item => item.outputId === output)?.lastFrame;
    if (frame && typeof frame.cpuMs === 'number') {
        frames.set(`${frame.sessionId}:${frame.sequence}`, frame);
        first ??= { sequence: frame.sequence, at: Date.now() };
        last = { sequence: frame.sequence, at: Date.now(), frame };
        for (const warning of [...(frame.warnings ?? []), ...(data.warnings ?? [])]) warnings.add(warning.message);
    }
    await wait(100);
}
const all = [...frames.values()], gpu = all.filter(frame => typeof frame.gpuMs === 'number').map(frame => frame.gpuMs);
console.log(JSON.stringify({
    label, output, at: new Date(start).toISOString(), measureS: Number(measureS), samples: all.length, cpuMs: summary(all.map(frame => frame.cpuMs)),
    gpuSamples: gpu.length, gpuUnknown: all.length - gpu.length, gpuMs: summary(gpu),
    sequencePerSecond: first && last && last.at > first.at ? round((last.sequence - first.sequence) / ((last.at - first.at) / 1000)) : 'unknown',
    backend: last?.frame.backend ?? 'unknown', qualityProfile: last?.frame.qualityProfile ?? 'unknown', revision: last?.frame.revision ?? 'unknown', warnings: [...warnings],
}));
child.stdin.end();
setTimeout(() => child.kill('SIGTERM'), 500).unref();
