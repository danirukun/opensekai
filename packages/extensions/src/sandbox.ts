import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import releaseVariant from '@jitl/quickjs-wasmfile-release-sync';
import {
 DEFAULT_LIMITS, EXTENSION_API_VERSION, ExtensionManifestSchema, GuestAssetTypeSchema, GuestNodeSchema, RESERVED_FILE_EXTENSIONS, portValuesSchema,
 type Capability, type ExtensionAssetType, type ExtensionManifest, type ExtensionNodeDefinition, type ExtensionStatus, type FailureCause, type PortValue, type RejectCause, type SandboxLimits,
} from './manifest';

export type LoadResult = { ok: true; status: ExtensionStatus } | { ok: false; reject: RejectCause };
export type EvaluateResult = { ok: true; outputs: Record<string, PortValue> } | { ok: false; reject: RejectCause } | { ok: false; failure: FailureCause };
export interface Catalog { nodes: ExtensionNodeDefinition[]; assetTypes: ExtensionAssetType[] }
export interface LogEntry { extensionId: string; message: string }

export interface SandboxOptions {
 limits?: Partial<SandboxLimits>;
 now?: () => number;
 variant?: QuickJSSyncVariant;
 onLog?: (entry: LogEntry) => void;
 onFailure?: (extensionId: string, cause: FailureCause) => void;
}

interface Loaded {
 manifest: ExtensionManifest; runtime: QuickJSRuntime; context: QuickJSContext; dispatch: QuickJSHandle;
 nodes: ExtensionNodeDefinition[]; assetTypes: ExtensionAssetType[];
 phase: 'load' | 'call';
 call: { deadline: number; interrupted: boolean; logs: number; fault: FailureCause | null };
}

// Trusted prelude. It hides the host bridge and keeps guest evaluators inside the guest VM.
// The host gets only strings back, and it validates each one.
// Binary buffers are hidden: guests do not need them yet, and they are the fastest way to fill the heap.
const HIDDEN_GLOBALS = ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
const PRELUDE = `(() => {
 for (const name of ${JSON.stringify(HIDDEN_GLOBALS)}) delete globalThis[name];
 const host = globalThis.__host; delete globalThis.__host;
 const evaluators = new Map(), stringify = JSON.stringify, parse = JSON.parse;
 const api = Object.freeze({
  apiVersion: ${EXTENSION_API_VERSION},
  log: message => host.log(String(message)),
  registerNode: definition => {
   if (typeof definition !== 'object' || definition === null || typeof definition.evaluate !== 'function') throw new TypeError('registerNode needs an evaluate function');
   const { evaluate, ...rest } = definition;
   host.registerNode(stringify(rest));
   evaluators.set(rest.type, evaluate);
  },
  registerAssetType: definition => host.registerAssetType(stringify(definition)),
 });
 Object.defineProperty(globalThis, 'opensekai', { value: api });
 return (type, inputs) => stringify(evaluators.get(type)(parse(inputs)));
})()`;

const truncate = (text: string, max = 512) => (text.length > max ? `${text.slice(0, max)}…` : text);

const classify = (error: unknown, call: Loaded['call']): FailureCause => {
 if (call.fault) return call.fault;
 // A trap inside the WASM instance, for example after QuickJS runs out of memory with a host function present.
 if (error instanceof WebAssembly.RuntimeError) return { code: 'error', message: truncate(`QuickJS stopped: ${error.message}`) };
 // QuickJS throws null when it runs out of memory again while it builds the out-of-memory error.
 if (error === null) return { code: 'memory', message: 'Memory limit exceeded' };
 if (error === undefined) return { code: 'error', message: 'QuickJS stopped without an error value' };
 if (call.interrupted) return { code: 'timeout', message: 'Time limit exceeded' };
 const { name, message } = (typeof error === 'object' && error !== null ? error : {}) as { name?: unknown; message?: unknown };
 const text = typeof message === 'string' ? message : String(error);
 if (name === 'InternalError' && text === 'out of memory') return { code: 'memory', message: 'Memory limit exceeded' };
 if (name === 'InternalError' && text === 'stack overflow') return { code: 'stack', message: 'Stack limit exceeded' };
 return { code: 'error', message: truncate(typeof name === 'string' ? `${name}: ${text}` : text) };
};

export async function createSandbox(options: SandboxOptions = {}) {
 const limits: SandboxLimits = { ...DEFAULT_LIMITS, ...options.limits };
 const now = options.now ?? (() => performance.now());
 const variant = options.variant ?? releaseVariant;
 const PAGE = 64 * 1024, INITIAL_HEAP = 16 * 1024 * 1024;
 if (!(limits.heapBytes >= INITIAL_HEAP)) throw new RangeError(`heapBytes must be at least ${INITIAL_HEAP}`);
 // A fresh memory with a fixed maximum for each instance: QuickJS cannot allocate past it.
 const heap = () => new WebAssembly.Memory({ initial: INITIAL_HEAP / PAGE, maximum: Math.floor(limits.heapBytes / PAGE) });
 const loaded = new Map<string, Loaded>();
 const failed = new Map<string, FailureCause>();
 const nodeOwner = new Map<string, string>();
 const extensionOwner = new Map<string, string>();
 const loading = new Set<string>();
 let discardedRuntimes = 0;

 const release = (entry: Loaded) => {
  for (const node of entry.nodes) nodeOwner.delete(node.type);
  for (const asset of entry.assetTypes) for (const ext of asset.fileExtensions) extensionOwner.delete(ext);
  entry.nodes = []; entry.assetTypes = [];
  try {
   if (entry.dispatch.alive) entry.dispatch.dispose();
   entry.context.dispose();
   entry.runtime.dispose();
  } catch {
   // QuickJS aborts on a leaked handle or a damaged heap. Only this extension's WASM instance is lost; no other extension shares it.
   discardedRuntimes += 1;
  }
 };

 const fail = (entry: Loaded, cause: FailureCause) => {
  loaded.delete(entry.manifest.id);
  release(entry);
  failed.set(entry.manifest.id, cause);
  try { options.onFailure?.(entry.manifest.id, cause); } catch { /* A host listener error must not change the result. */ }
 };

 const bridge = (entry: Loaded) => {
  const { context } = entry;
  const fault = (cause: FailureCause): never => {
   entry.call.fault ??= cause;
   throw new Error(cause.message);
  };
  const text = (handle: QuickJSHandle) => (context.typeof(handle) === 'string' ? context.getString(handle) : fault({ code: 'invalid', message: 'Bridge argument is not a string' }));
  const require = (capability: Capability) => {
   if (!entry.manifest.capabilities.includes(capability)) fault({ code: 'denied', message: `Capability not granted: ${capability}` });
   if (capability !== 'log' && entry.phase !== 'load') fault({ code: 'denied', message: 'Registration is allowed only while the extension loads' });
  };
  const json = (handle: QuickJSHandle): unknown => {
   try { return JSON.parse(text(handle)); } catch { return fault({ code: 'invalid', message: 'Definition is not plain data' }); }
  };
  const host = context.newObject();
  const define = (name: string, body: (arg: QuickJSHandle) => void) => {
   const fn = context.newFunction(name, arg => { body(arg); });
   context.setProp(host, name, fn);
   fn.dispose();
  };
  define('log', arg => {
   require('log');
   const message = text(arg);
   if (++entry.call.logs > limits.logsPerCall) fault({ code: 'quota', message: `More than ${limits.logsPerCall} log messages in one call` });
   try { options.onLog?.({ extensionId: entry.manifest.id, message: truncate(message, limits.logBytes) }); } catch { /* Not the guest's fault. */ }
  });
  define('registerNode', arg => {
   require('nodes');
   const parsed = GuestNodeSchema.safeParse(json(arg));
   if (!parsed.success) fault({ code: 'invalid', message: `Invalid node: ${truncate(parsed.error.message, 256)}` });
   const definition = parsed.data!;
   const type = `${entry.manifest.id}/${definition.type}`;
   if (nodeOwner.has(type)) fault({ code: 'invalid', message: `Node already registered: ${type}` });
   if (entry.nodes.length >= limits.nodes) fault({ code: 'quota', message: `More than ${limits.nodes} nodes` });
   entry.nodes.push({ extensionId: entry.manifest.id, type, label: definition.label, inputs: { ...definition.inputs }, outputs: { ...definition.outputs } });
   nodeOwner.set(type, entry.manifest.id);
  });
  define('registerAssetType', arg => {
   require('assetTypes');
   const parsed = GuestAssetTypeSchema.safeParse(json(arg));
   if (!parsed.success) fault({ code: 'invalid', message: `Invalid asset type: ${truncate(parsed.error.message, 256)}` });
   const definition = parsed.data!;
   const taken = definition.fileExtensions.find(ext => RESERVED_FILE_EXTENSIONS.includes(ext) || extensionOwner.has(ext));
   if (taken) fault({ code: 'invalid', message: `File extension is not available: ${taken}` });
   if (entry.assetTypes.length >= limits.assetTypes) fault({ code: 'quota', message: `More than ${limits.assetTypes} asset types` });
   const fileExtensions = [...new Set(definition.fileExtensions)];
   entry.assetTypes.push({ extensionId: entry.manifest.id, kind: `${entry.manifest.id}/${definition.kind}`, label: definition.label, fileExtensions });
   for (const ext of fileExtensions) extensionOwner.set(ext, entry.manifest.id);
  });
  context.setProp(context.global, '__host', host);
  host.dispose();
 };

 // Runs one guest entry with a fresh deadline and log count. A fault set by the bridge wins over a guest catch.

 const guarded = <T>(entry: Loaded, budgetMs: number, run: () => T): { ok: true; value: T } | { ok: false; cause: FailureCause } => {
  entry.call = { deadline: now() + budgetMs, interrupted: false, logs: 0, fault: null };
  try {
   const value = run();
   return entry.call.fault || entry.call.interrupted ? { ok: false, cause: classify(null, entry.call) } : { ok: true, value };
  } catch (error) {
   return { ok: false, cause: classify(error, entry.call) };
  }
 };

 // `dump` is not reliable at the memory limit (it can return an empty string), so read only `name` and `message`.
 const readError = (context: QuickJSContext, error: QuickJSHandle): unknown => {
  if (context.typeof(error) !== 'object') return context.dump(error);
  if (context.sameValue(error, context.null)) return null;
  const text = (key: string) => {
   const prop = context.getProp(error, key);
   try { return context.typeof(prop) === 'string' ? context.getString(prop) : undefined; } finally { prop.dispose(); }
  };
  return { name: text('name'), message: text('message') };
 };

 // Reading the error allocates. The QuickJS limit is lifted for the read; the WASM maximum still bounds the heap.
 const unwrap = (entry: Loaded, result: ReturnType<QuickJSContext['evalCode']>): QuickJSHandle => {
  if (result.error) {
   let dumped: unknown;
   entry.runtime.setMemoryLimit(-1);
   try { dumped = readError(entry.context, result.error); } finally { result.error.dispose(); entry.runtime.setMemoryLimit(limits.memoryBytes); }
   throw dumped;
  }
  return result.value;
 };

 async function load(rawManifest: unknown, source: string): Promise<LoadResult> {
  const parsed = ExtensionManifestSchema.safeParse(rawManifest);
  if (!parsed.success) return { ok: false, reject: { code: 'manifest', message: truncate(parsed.error.message) } };
  const manifest = parsed.data;
  if (loaded.has(manifest.id) || loading.has(manifest.id)) return { ok: false, reject: { code: 'duplicate', message: `Extension already loaded: ${manifest.id}` } };
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > limits.sourceBytes)
   return { ok: false, reject: { code: 'manifest', message: `Source is larger than ${limits.sourceBytes} bytes` } };
  failed.delete(manifest.id);
  loading.add(manifest.id);
  // One WASM instance per extension: a fatal VM error cannot reach another extension.
  let module: Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>;
  try { module = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: heap() })); } finally { loading.delete(manifest.id); }
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  const context = runtime.newContext();
  const entry: Loaded = { manifest, runtime, context, dispatch: context.undefined, nodes: [], assetTypes: [], phase: 'load', call: { deadline: Infinity, interrupted: false, logs: 0, fault: null } };
  runtime.setInterruptHandler(() => {
   if (now() <= entry.call.deadline) return false;
   entry.call.interrupted = true;
   return true;
  });
  loaded.set(manifest.id, entry);
  const result = guarded(entry, limits.loadMs, () => {
   bridge(entry);
   entry.dispatch = unwrap(entry, context.evalCode(PRELUDE, 'prelude.js', { type: 'global' }));
   unwrap(entry, context.evalCode(source, `${manifest.id}.js`, { type: 'global' })).dispose();
  });
  entry.call.deadline = Infinity;
  entry.phase = 'call';
  if (!result.ok) {
   fail(entry, result.cause);
   return { ok: true, status: { id: manifest.id, state: 'failed', cause: result.cause } };
  }
  return { ok: true, status: { id: manifest.id, state: 'ready' } };
 }

 function evaluate(type: string, inputs: unknown): EvaluateResult {
  const owner = nodeOwner.get(type);
  const entry = owner === undefined ? undefined : loaded.get(owner);
  const node = entry?.nodes.find(candidate => candidate.type === type);
  if (!entry || !node) return { ok: false, reject: { code: 'unknown-node', message: `No ready extension node: ${type}` } };
  const input = portValuesSchema(node.inputs).safeParse(inputs);
  if (!input.success) return { ok: false, reject: { code: 'input', message: truncate(input.error.message) } };
  const { context } = entry;
  const localType = type.slice(entry.manifest.id.length + 1);
  const result = guarded(entry, limits.callMs, () => {
   let out: QuickJSHandle;
   const typeHandle = context.newString(localType);
   try {
    const inputHandle = context.newString(JSON.stringify(input.data));
    try { out = unwrap(entry, context.callFunction(entry.dispatch, context.undefined, typeHandle, inputHandle)); }
    finally { inputHandle.dispose(); }
   } finally { typeHandle.dispose(); }
   try { return context.typeof(out) === 'string' ? context.getString(out) : null; } finally { out.dispose(); }
  });
  entry.call.deadline = Infinity;
  const outcome = (cause: FailureCause): EvaluateResult => { fail(entry, cause); return { ok: false, failure: cause }; };
  if (!result.ok) return outcome(result.cause);
  if (result.value === null) return outcome({ code: 'invalid', message: 'Node returned no outputs' });
  if (result.value.length > limits.resultBytes) return outcome({ code: 'quota', message: `Node outputs are larger than ${limits.resultBytes} bytes` });
  let raw: unknown;
  try { raw = JSON.parse(result.value); } catch { return outcome({ code: 'invalid', message: 'Node outputs are not JSON' }); }
  const outputs = portValuesSchema(node.outputs).safeParse(raw);
  if (!outputs.success) return outcome({ code: 'invalid', message: `Invalid node outputs: ${truncate(outputs.error.message, 256)}` });
  return { ok: true, outputs: outputs.data as Record<string, PortValue> };
 }

 const unload = (id: string): boolean => {
  const entry = loaded.get(id);
  failed.delete(id);
  if (!entry) return false;
  loaded.delete(id);
  release(entry);
  return true;
 };

 const catalog = (): Catalog => ({
  nodes: [...loaded.values()].flatMap(entry => entry.nodes.map(node => ({ ...node, inputs: { ...node.inputs }, outputs: { ...node.outputs } }))),
  assetTypes: [...loaded.values()].flatMap(entry => entry.assetTypes.map(asset => ({ ...asset, fileExtensions: [...asset.fileExtensions] }))),
 });

 const statuses = (): ExtensionStatus[] => [
  ...[...loaded.keys()].map(id => ({ id, state: 'ready' as const })),
  ...[...failed].map(([id, cause]) => ({ id, state: 'failed' as const, cause })),
 ];

 const dispose = () => { for (const id of [...loaded.keys()]) unload(id); failed.clear(); };

 return { load, evaluate, unload, catalog, statuses, dispose, limits, discardedRuntimes: () => discardedRuntimes };
}

export type Sandbox = Awaited<ReturnType<typeof createSandbox>>;
