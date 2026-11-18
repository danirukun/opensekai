#!/usr/bin/env node
// Read the isolated OpenSekai QA browser source from OBS (ws://127.0.0.1:4455, no auth) as fast as OBS answers.
// It never starts streaming or recording and changes no OBS setting.
// Usage: node docs/evaluation/spring-bones/obs-frames.mjs <sourceName> <outDir> [seconds=4] [width=960]
// Writes <outDir>/frame-<n>.png and <outDir>/times.json (milliseconds after the first request).
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [sourceName, outDir, seconds = '4', width = '960'] = process.argv.slice(2);
if (!sourceName || !outDir) { console.error('usage: obs-frames.mjs <sourceName> <outDir> [seconds] [width]'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const socket = new WebSocket('ws://127.0.0.1:4455');
const waiting = new Map();
const ready = new Promise((settle, reject) => {
    socket.addEventListener('message', event => {
        const { op, d } = JSON.parse(event.data);
        if (op === 0) socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } }));
        else if (op === 2) settle();
        else if (op === 7) { waiting.get(d.requestId)?.(d); waiting.delete(d.requestId); }
    });
    socket.addEventListener('error', () => reject(new Error('Cannot connect to OBS')));
});
const call = (requestType, requestData) => new Promise((settle, reject) => {
    const requestId = randomUUID();
    waiting.set(requestId, d => d.requestStatus.result ? settle(d.responseData) : reject(new Error(d.requestStatus.comment)));
    socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
});
await ready;
const start = performance.now(), times = [];
for (let index = 0; performance.now() - start < Number(seconds) * 1000; index++) {
    const { imageData } = await call('GetSourceScreenshot', { sourceName, imageFormat: 'png', imageWidth: Number(width), imageHeight: Math.round(Number(width) * 9 / 16) });
    times.push(Math.round(performance.now() - start));
    writeFileSync(join(outDir, `frame-${String(index).padStart(4, '0')}.png`), Buffer.from(imageData.split(',')[1], 'base64'));
}
writeFileSync(join(outDir, 'times.json'), JSON.stringify(times));
console.log(JSON.stringify({ frames: times.length, seconds: times.at(-1) / 1000 }));
socket.close();
