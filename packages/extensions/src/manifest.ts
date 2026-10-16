import { z } from 'zod';

export const EXTENSION_API_VERSION = 1;
export const CAPABILITIES = ['log', 'nodes', 'assetTypes'] as const;
export type Capability = (typeof CAPABILITIES)[number];

// File extensions that built-in importers and show files own. A guest cannot claim them.
export const RESERVED_FILE_EXTENSIONS: readonly string[] = ['.vrm', '.glb', '.gltf', '.zip', '.osekai', '.json'];

const localName = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
const label = z.string().trim().min(1).max(64);

export const ExtensionManifestSchema = z.strictObject({
 manifestVersion: z.literal(1),
 id: z.string().max(128).regex(/^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/),
 name: label,
 version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/),
 apiVersion: z.literal(EXTENSION_API_VERSION),
 capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).refine(list => new Set(list).size === list.length, 'Duplicate capability'),
});
export type ExtensionManifest = z.output<typeof ExtensionManifestSchema>;

export const DataPortTypeSchema = z.enum(['number', 'boolean', 'vector3']);
export type DataPortType = z.output<typeof DataPortTypeSchema>;
const ports = (min: number) => z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,31}$/), DataPortTypeSchema)
 .refine(record => Object.keys(record).length >= min && Object.keys(record).length <= 16, `Between ${min} and 16 ports`);

// What a guest passes to `opensekai.registerNode`, without its `evaluate` function.
export const GuestNodeSchema = z.strictObject({ type: localName, label, inputs: ports(0), outputs: ports(1) });
export const GuestAssetTypeSchema = z.strictObject({
 kind: localName, label,
 fileExtensions: z.array(z.string().regex(/^\.[a-z0-9]{1,16}$/)).min(1).max(8),
});

export interface ExtensionNodeDefinition { extensionId: string; type: string; label: string; inputs: Record<string, DataPortType>; outputs: Record<string, DataPortType> }
export interface ExtensionAssetType { extensionId: string; kind: string; label: string; fileExtensions: string[] }

export type FailureCode = 'timeout' | 'memory' | 'stack' | 'denied' | 'quota' | 'invalid' | 'error' | 'unresponsive';
export type RejectCode = 'manifest' | 'duplicate' | 'unknown-node' | 'input' | 'closed';
export interface FailureCause { code: FailureCode; message: string }
export interface RejectCause { code: RejectCode; message: string }

export type ExtensionStatus = { id: string; state: 'ready' } | { id: string; state: 'failed'; cause: FailureCause };

export type Vec3 = [number, number, number];
export type PortValue = number | boolean | Vec3;

const valueSchema = (type: DataPortType) =>
 type === 'number' ? z.number().finite() : type === 'boolean' ? z.boolean() : z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const portValuesSchema = (shape: Record<string, DataPortType>) =>
 z.strictObject(Object.fromEntries(Object.entries(shape).map(([name, type]) => [name, valueSchema(type)])));

export interface SandboxLimits {
 // `memoryBytes` is the QuickJS allocator limit (soft). `heapBytes` is the WASM memory maximum of the instance (hard).
 memoryBytes: number; heapBytes: number; stackBytes: number;
 sourceBytes: number; loadMs: number; callMs: number;
 logsPerCall: number; logBytes: number; resultBytes: number;
 nodes: number; assetTypes: number;
}
export const DEFAULT_LIMITS: SandboxLimits = {
 memoryBytes: 16 * 1024 * 1024, heapBytes: 64 * 1024 * 1024, stackBytes: 256 * 1024,
 sourceBytes: 1024 * 1024, loadMs: 250, callMs: 5,
 logsPerCall: 8, logBytes: 1024, resultBytes: 16 * 1024,
 nodes: 64, assetTypes: 16,
};
