#!/usr/bin/env node
// Call the OpenSekai MCP server once over stdio, with no SDK dependency.
// Usage (from the repository root, with the app running):
//   node mcp-call.mjs --list                      list tool names and descriptions
//   node mcp-call.mjs --schema scene_patch        print one tool's input schema
//   node mcp-call.mjs --resources                 list resources
//   node mcp-call.mjs --read opensekai://status   read a resource
//   node mcp-call.mjs app_status '{}'             call a tool with JSON arguments
// Options: --repo <root> (default: cwd), --descriptor <operator.json>, --out <dir> (where image content is saved)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const option = name => {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const [, value] = argv.splice(index, 2);
  return value;
};
const flag = name => {
  const index = argv.indexOf(name);
  if (index === -1) return false;
  argv.splice(index, 1);
  return true;
};

const repo = resolve(option('--repo') ?? process.cwd());
const descriptor = resolve(option('--descriptor') ?? join(homedir(), 'Library/Application Support/com.oshi-connect.opensekai/operator.json'));
const outDir = option('--out');
const readUri = option('--read');
const list = flag('--list');
const schemaOf = option('--schema');
const resources = flag('--resources');
const [tool, rawArgs = '{}'] = argv;

if (!existsSync(join(repo, 'apps/mcp/src/cli.ts'))) fail(`No apps/mcp/src/cli.ts under ${repo}. Pass --repo <opensekai root>.`);
if (!existsSync(descriptor)) fail(`No operator descriptor at ${descriptor}. Is the app running?`);
if (!list && !schemaOf && !resources && !readUri && !tool) fail('Pass --list, --schema <tool>, --resources, --read <uri>, or <tool> [json-args].');

let toolArgs;
try { toolArgs = JSON.parse(rawArgs); } catch { fail('Tool arguments must be JSON.'); }

const child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp/src/cli.ts'], {
  cwd: repo,
  env: { ...process.env, OPENSEKAI_CONNECTION_FILE: descriptor },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });

const pending = new Map();
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});
child.on('exit', code => {
  for (const settle of pending.values()) settle({ error: { message: `MCP server exited (${code}). ${stderr.trim()}` } });
  pending.clear();
});

let nextId = 1;
const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const request = (method, params) => new Promise((settle, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error(`${method} timed out after 60 s`)), 60_000);
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message ?? JSON.stringify(message.error))) : settle(message.result); });
  send({ id, method, params });
});

const saveImages = result => {
  if (!outDir || !Array.isArray(result?.content)) return result;
  mkdirSync(outDir, { recursive: true });
  const content = result.content.map((item, index) => {
    if (item.type !== 'image' || typeof item.data !== 'string') return item;
    const ext = item.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const path = resolve(outDir, `${tool ?? 'resource'}-${Date.now()}-${index}.${ext}`);
    writeFileSync(path, Buffer.from(item.data, 'base64'));
    return { type: 'image', mimeType: item.mimeType, savedTo: path };
  });
  return { ...result, content };
};

try {
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-qa-e2e', version: '1.0.0' } });
  send({ method: 'notifications/initialized' });
  const tools = list || schemaOf ? (await request('tools/list', {})).tools : [];
  const result = list ? tools.map(({ name, description }) => ({ name, description }))
    : schemaOf ? (tools.find(item => item.name === schemaOf)?.inputSchema ?? fail(`No tool ${schemaOf}.`))
    : resources ? await request('resources/list', {})
    : readUri ? await request('resources/read', { uri: readUri })
    : saveImages(await request('tools/call', { name: tool, arguments: toolArgs }));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result?.isError) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  setTimeout(() => child.kill('SIGTERM'), 500).unref();
}

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(1);
}
