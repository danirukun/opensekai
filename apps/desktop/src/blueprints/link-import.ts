import { importBlueprint, type BlueprintGraph, type Id, type Reply, type SceneView } from '@opensekai/contracts';
import { MAX_GRAPHS } from './templates';

// The reply of the host command `take_blueprint_link` (B39).
export interface LinkDownload { text: string; host: string }
export type LinkImportState =
 | { kind: 'idle' }
 | { kind: 'loading' }
 | { kind: 'confirm'; text: string; host: string }
 | { kind: 'failed'; message: string };
export interface LinkSummary { graph: BlueprintGraph; name: string; host: string; nodeCount: number; missing: string[] }

// A linked graph is always added disabled (B39 R10, R15), also when the file has it enabled and nothing is missing.
export function linkSummary(text: string, host: string, scene: SceneView, graphCount: number, newId: () => Id): Reply<LinkSummary> {
 if (graphCount >= MAX_GRAPHS) return { ok: false, error: { code: 'INVALID_INPUT', message: `Show already has ${MAX_GRAPHS} blueprints`, ids: [] } };
 const imported = importBlueprint(text, scene, newId);
 if (!imported.ok) return imported;
 const graph = { ...imported.data.graph, enabled: false };
 return { ok: true, data: { graph, name: graph.name, host, nodeCount: graph.nodes.length, missing: imported.data.report.missing.map(item => item.name) } };
}

export const countLine = (nodeCount: number, host: string) => `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} · ${host}`;
