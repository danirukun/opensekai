#!/usr/bin/env node
// Sample the renderer frame cost (FrameApplied.cpuMs) of one output from MCP app_status, with one MCP connection.
// Usage (repository root, app running): node docs/evaluation/spring-bones/cost-sample.mjs <label> [warmupS=30] [measureS=120] [output=output_main] [windows=1]
// After the warmup it measures <windows> windows back to back and prints one JSON line for each:
// label, window, samples (distinct frames), mean, p50, p95, max, resolutionMs (smallest step between distinct values), backend, qualityProfile.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [label = 'run', warmupS = '30', measureS = '120', output = 'output_main', windows = '1'] = process.argv.slice(2);
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
const frameOf = data => data.outputs?.find(item => item.outputId === output)?.lastFrame;
const wait = ms => new Promise(settle => setTimeout(settle, ms));
const round = value => value === undefined || Number.isNaN(value) ? 'unknown' : Math.round(value * 1000) / 1000;

const measure = async window => {
    // Keyed by sequence: a poll that sees the same frame again does not count it twice.
    const samples = new Map();
    let last;
    const end = Date.now() + Number(measureS) * 1000;
    while (Date.now() < end) {
        const frame = frameOf(await status());
        if (frame && typeof frame.cpuMs === 'number') { samples.set(`${frame.sessionId}:${frame.sequence}`, frame.cpuMs); last = frame; }
        await wait(100);
    }
    const values = [...samples.values()].sort((a, b) => a - b);
    const at = q => values[Math.min(values.length - 1, Math.floor(q * values.length))];
    const distinct = [...new Set(values.map(value => Math.round(value * 1e6) / 1e6))];
    const steps = distinct.slice(1).map((value, index) => value - distinct[index]);
    console.log(JSON.stringify({ label, output, window, samples: values.length, mean: round(values.reduce((sum, value) => sum + value, 0) / values.length), p50: round(at(.5)), p95: round(at(.95)), max: round(values.at(-1)), resolutionMs: steps.length ? round(Math.min(...steps)) : 'unknown', backend: last?.backend ?? 'unknown', qualityProfile: last?.qualityProfile ?? 'unknown', gpuMs: last?.gpuMs ?? 'unknown' }));
};

await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'spring-cost', version: '1.0.0' } });
send({ method: 'notifications/initialized' });
await wait(Number(warmupS) * 1000);
for (let window = 1; window <= Number(windows); window++) await measure(window);
child.stdin.end();
setTimeout(() => child.kill('SIGTERM'), 500).unref();
