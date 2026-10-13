import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectClient } from '@opensekai/browser-client';
import { ConnectionDescriptorSchema, exportBlueprint, importBlueprint, serializeBlueprintFile, type AppApi, type BlueprintGraph, type BlueprintImport, type Reply, type SceneView, type Vec3 } from '@opensekai/contracts';

export interface BlueprintCheck { name: string; ok: boolean; detail: string }
export interface BlueprintEvalPorts { sleep(ms: number): Promise<void>; newId(): string }
const SCENE = 'scene_smoke', NUDGE: Vec3 = [0.2, 1.1, -0.5];

const unwrap = <T>(reply: Reply<T>, what: string): T => { if (!reply.ok) throw new Error(`${what}: ${reply.error.code} ${reply.error.message}`); return reply.data; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function evaluateBlueprintFiles(api: AppApi, files: ReadonlyMap<string, string>, ports: BlueprintEvalPorts): Promise<BlueprintCheck[]> {
 const first = await api.sceneInspect({ sceneId: SCENE });
 if (!first.ok) throw new Error('Open the smoke scene first');
 const original = structuredClone(first.data.entities.find(e => e.id === 'reference')!.transform);
 const added: string[] = [], checks: BlueprintCheck[] = [];
 const scene = async () => unwrap(await api.sceneInspect({ sceneId: SCENE }), 'sceneInspect');
 const position = async (id: string) => (await scene()).entities.find(e => e.id === id)!.transform.position;
 const text = (name: string) => { const value = files.get(name); if (value === undefined) throw new Error(`Missing fixture ${name}`); return value; };
 const edit = async (ops: unknown[]) => unwrap(await api.blueprintEdit({ clientId: 'evaluate-blueprints', batchId: ports.newId(), ops } as never), 'blueprintEdit');
 const stored = async (id: string): Promise<BlueprintGraph> => {
  const inspect = unwrap(await api.blueprintInspect({}), 'blueprintInspect');
  const graph = inspect.kind === 'snapshot' ? inspect.blueprints.find(item => item.id === id) : undefined;
  if (!graph) throw new Error(`Blueprint ${id} not stored`);
  return graph;
 };
 const load = async (name: string): Promise<BlueprintImport & { edit: Awaited<ReturnType<typeof edit>> }> => {
  const imported = unwrap(importBlueprint(text(name), await scene(), ports.newId), `import ${name}`);
  const result = await edit([{ kind: 'createGraph', graph: imported.graph }]);
  added.push(imported.graph.id);
  return { ...imported, edit: result };
 };
 const unload = async (id: string) => { await edit([{ kind: 'removeGraph', graphId: id }]); added.splice(added.indexOf(id), 1); };
 // Export of the stored graph gives the fixture back, except the new graph ID.
 const roundTrip = async (name: string, id: string) => {
  const file = JSON.parse(text(name));
  return serializeBlueprintFile(exportBlueprint(await stored(id), await scene())) === serializeBlueprintFile({ ...file, graph: { ...file.graph, id } });
 };
 const check = async (name: string, run: () => Promise<string | null>) => {
  try { const failure = await run(); checks.push({ name, ok: failure === null, detail: failure ?? 'ok' }); }
  catch (error) { checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
 };
 const expectCode = (name: string, code: string) => check(`rejects ${name}`, async () => {
  const result = importBlueprint(text(name), await scene(), ports.newId);
  return !result.ok && result.error.code === code ? null : `expected ${code}, got ${JSON.stringify(result)}`;
 });
 const runNudge = async (id: string) => {
  unwrap(await api.blueprintRun({ graphId: id, triggerNodeId: 'run' }), 'blueprintRun');
  await ports.sleep(600);
  return same(await position('reference'), NUDGE) ? null : `reference at ${JSON.stringify(await position('reference'))}`;
 };
 try {
  await expectCode('future-version', 'VERSION_MISMATCH');
  await expectCode('unknown-node', 'UNSUPPORTED');
  await expectCode('warudo-shaped', 'INVALID_INPUT');
  await check('nudge', async () => {
   const { graph } = await load('nudge');
   if (!(await roundTrip('nudge', graph.id))) return 'export differs';
   const failure = await runNudge(graph.id);
   await unload(graph.id);
   return failure;
  });
  await check('drift', async () => {
   const { graph } = await load('drift');
   if (!(await roundTrip('drift', graph.id))) return 'export differs';
   await ports.sleep(200);
   const start = await scene(), from = start.entities.find(e => e.id === 'reference')!.transform.position;
   await ports.sleep(800);
   const during = await scene();
   if (during.revision !== start.revision || !same(during.entities.find(e => e.id === 'reference')!.transform.position, from)) return 'committed during motion';
   await edit([{ kind: 'updateGraph', graphId: graph.id, enabled: false }]);
   await ports.sleep(600);
   const [x, y, z] = await position('reference');
   await unload(graph.id);
   return x - from[0] > 0.2 && y === from[1] && z === from[2] ? null : `moved from ${JSON.stringify(from)} to ${JSON.stringify([x, y, z])}`;
  });
  await check('wasd', async () => {
   const { graph, edit: result } = await load('wasd');
   const ok = await roundTrip('wasd', graph.id) && same([...(result.heldKeys ?? [])].sort(), ['KeyA', 'KeyD', 'KeyS', 'KeyW']);
   await unload(graph.id);
   return ok ? null : `heldKeys ${JSON.stringify(result.heldKeys)}`;
  });
  for (const [name, accelerator] of [['camera-flip', 'Control+Alt+KeyH'], ['counter', 'Control+Alt+KeyJ']] as const)
   await check(name, async () => {
    const { graph, edit: result } = await load(name);
    const ok = await roundTrip(name, graph.id) && result.keystrokes.includes(accelerator);
    await unload(graph.id);
    return ok ? null : `keystrokes ${JSON.stringify(result.keystrokes)}`;
   });
  await check('renamed-ids', async () => {
   const { graph, report } = await load('renamed-ids');
   if (!same(report.remapped, [{ name: 'reference', kind: 'mesh', from: 'old-reference', to: 'reference' }])) return `remapped ${JSON.stringify(report.remapped)}`;
   const failure = await runNudge(graph.id);
   await unload(graph.id);
   return failure;
  });
  await check('missing-ref', async () => {
   const { graph, report } = await load('missing-ref');
   const ok = !(await stored(graph.id)).enabled && same(report.missing.map(item => item.name), ['Ghost']);
   await unload(graph.id);
   return ok ? null : `report ${JSON.stringify(report)}`;
  });
 } finally {
  for (const id of [...added]) await unload(id).catch(() => {});
  const now = await scene();
  if (!same(now.entities.find(e => e.id === 'reference')!.transform, original))
   unwrap(await api.scenePatch({ sceneId: SCENE, expectedRevision: now.revision, operations: [{ kind: 'setTransform', entityId: 'reference', transform: original }] } as never), 'restore reference');
 }
 return checks;
}

async function runCli(env: NodeJS.ProcessEnv = process.env): Promise<number> {
 const path = env.OPENSEKAI_CONNECTION_FILE;
 if (!path) throw new Error('OPENSEKAI_CONNECTION_FILE is required');
 const descriptor = ConnectionDescriptorSchema.parse(JSON.parse(await readFile(path, 'utf8')));
 const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
 const dir = join(root, 'fixtures/blueprints');
 const files = new Map(await Promise.all((await readdir(dir)).filter(name => name.endsWith('.json')).map(async name => [name.replace(/\.json$/, ''), await readFile(join(dir, name), 'utf8')] as const)));
 const client = await connectClient(descriptor);
 try {
  const status = unwrap(await client.api.appStatus({}), 'appStatus');
  const startedAt = new Date().toISOString();
  const checks = await evaluateBlueprintFiles(client.api, files, { sleep: ms => new Promise(done => setTimeout(done, ms)), newId: () => crypto.randomUUID() });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const out = join(root, 'artifacts/evaluation/blueprint-files');
  await mkdir(out, { recursive: true });
  const file = join(out, `${startedAt.replaceAll(':', '-')}.json`);
  await writeFile(file, `${JSON.stringify({ schemaVersion: 1, commit, sessionId: status.sessionId, startedAt, checks }, null, 2)}\n`);
  for (const item of checks) process.stdout.write(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.ok ? '' : ` — ${item.detail}`}\n`);
  process.stdout.write(`Report: ${file}\n`);
  return checks.every(item => item.ok) ? 0 : 1;
 } finally { client.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 runCli().then(code => { process.exitCode = code; }, error => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
}
