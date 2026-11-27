// QA helpers: an MCP stdio client to the running app and an OBS WebSocket 5 client. Run from the repository root.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const wait = ms => new Promise(settle => setTimeout(settle, ms));

export async function mcp() {
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
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'snow-cover-qa', version: '1.0.0' } });
    send({ method: 'notifications/initialized' });
    const call = async (name, args = {}) => JSON.parse((await request('tools/call', { name, arguments: args })).content[0].text);
    return { call, close: () => { child.stdin.end(); setTimeout(() => child.kill('SIGTERM'), 300).unref(); } };
}

export async function obs(url = 'ws://127.0.0.1:4455') {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1, identified;
    const ready = new Promise(settle => { identified = settle; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.op === 0) socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0 } }));
        if (message.op === 2) identified();
        if (message.op === 7) { pending.get(message.d.requestId)?.(message.d); pending.delete(message.d.requestId); }
    };
    await ready;
    const request = (requestType, requestData = {}) => new Promise((settle, reject) => {
        const requestId = String(nextId++);
        pending.set(requestId, d => d.requestStatus.result ? settle(d.responseData ?? {}) : reject(new Error(`${requestType}: ${d.requestStatus.code} ${d.requestStatus.comment ?? ''}`)));
        socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
    return { request, close: () => socket.close() };
}
