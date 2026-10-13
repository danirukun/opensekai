import { expect, it } from 'vitest';
import { exportBlueprint, importBlueprint, makeSmokeScene, serializeBlueprintFile, type BlueprintGraph, type SceneView } from '../src';

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[] = [], extra: Partial<BlueprintGraph> = {}): BlueprintGraph =>
 ({ schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes, connections, ...extra } as BlueprintGraph);
const manual = { id: 'run', version: 1, type: 'event.manual', settings: {}, position: at };
const toggle = (id: string, entityId: string) => ({ id, version: 1, type: 'scene.toggleVisibility', settings: { entityId }, position: at });
const cut = (id: string, cameraId: string) => ({ id, version: 1, type: 'camera.switch', settings: { outputId: 'preview_main', cameraId }, position: at });
const wire = (id: string, from: string, to: string) => ({ id, sourceNodeId: from, sourcePort: 'flow', targetNodeId: to, targetPort: 'flow' });
const rename = (scene: SceneView, id: string, next: { id?: string; name?: string }): SceneView =>
 ({ ...scene, entities: scene.entities.map(e => e.id === id ? { ...e, ...next } : e) } as SceneView);
const ids = () => { let n = 0; return () => `new-${++n}`; };
const ok = <T>(reply: { ok: true; data: T } | { ok: false }): T => { if (!reply.ok) throw new Error(JSON.stringify(reply)); return reply.data; };
const scene = makeSmokeScene();
const sample = graph([manual, toggle('hide', 'marker'), cut('cut', 'camera_close')], [wire('w1', 'run', 'hide'), wire('w2', 'hide', 'cut')]);

it('exports each referenced entity and output once, in order of first use', () => {
 const file = exportBlueprint(sample, scene);
 expect(file).toEqual({ format: 'opensekai.blueprint', formatVersion: 1, graph: sample, references: [
  { id: 'marker', kind: 'mesh', name: 'marker' },
  { id: 'preview_main', kind: 'output', name: 'preview_main' },
  { id: 'camera_close', kind: 'camera', name: 'camera_close' },
 ] });
 expect(exportBlueprint(graph([toggle('hide', 'ghost')]), scene).references).toEqual([{ id: 'ghost', kind: 'unknown', name: 'ghost' }]);
 expect(serializeBlueprintFile(file)).toBe(`${JSON.stringify(file, null, 2)}\n`);
});

it('imports an export as a new graph with the same content', () => {
 const text = serializeBlueprintFile(exportBlueprint(sample, scene));
 const imported = ok(importBlueprint(text, scene, ids()));
 expect(imported.graph).toEqual({ ...sample, id: 'new-1' });
 expect(imported.report).toEqual({ graphId: 'new-1', enabled: true, remapped: [], missing: [] });
 const again = ok(importBlueprint(text, scene, () => 'new-2'));
 expect(again.graph.id).not.toBe(imported.graph.id);
});

it('accepts the parsed object and a leading byte order mark', () => {
 const file = exportBlueprint(sample, scene);
 expect(ok(importBlueprint(file, scene, ids())).graph.nodes).toEqual(sample.nodes);
 expect(ok(importBlueprint(`﻿${serializeBlueprintFile(file)}`, scene, ids())).graph.nodes).toEqual(sample.nodes);
});

it('rejects files in the order of the checks', () => {
 const file = exportBlueprint(sample, scene);
 const fail = (input: unknown) => importBlueprint(input, scene, ids());
 expect(fail('x'.repeat(1024 * 1024 + 1))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Blueprint file is too large' } });
 for (const input of ['{', '[]', JSON.stringify({ id: 'w', nodes: {}, flowConnections: [] }), JSON.stringify({ ...file, formatVersion: 0 }), JSON.stringify({ ...file, formatVersion: 1.5 })])
  expect(fail(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Not an OpenSekai Blueprint file' } });
 expect(fail({ ...file, formatVersion: 2 })).toMatchObject({ ok: false, error: { code: 'VERSION_MISMATCH', message: 'Blueprint file needs a newer OpenSekai' } });
 const odd = (id: string, type: string) => ({ id, version: 1, type, settings: {}, position: at });
 const unknown = { ...file, graph: { ...file.graph, nodes: [...file.graph.nodes, odd('a', 'character.wave'), odd('b', 'character.wave'), odd('c', 'audio.beat')] } };
 expect(fail(unknown)).toEqual({ ok: false, error: { code: 'UNSUPPORTED', message: 'Unknown node types: character.wave, audio.beat', ids: ['a', 'b', 'c'] } });
 expect(fail({ ...file, extra: true })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(fail({ ...file, graph: { ...file.graph, nodes: [manual, manual] } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Duplicate node ID' } });
});

it('keeps an ID that exists with a fitting kind', () => {
 const imported = ok(importBlueprint(exportBlueprint(sample, scene), scene, ids()));
 expect(imported.report.remapped).toEqual([]);
});

it('changes a reference to the one entity with the same name and kind', () => {
 const old = rename(scene, 'marker', { id: 'old-marker' });
 const imported = ok(importBlueprint(exportBlueprint(graph([toggle('hide', 'old-marker')]), old), scene, ids()));
 expect(imported.graph.nodes[0]).toMatchObject({ settings: { entityId: 'marker' } });
 expect(imported.report.remapped).toEqual([{ name: 'marker', kind: 'mesh', from: 'old-marker', to: 'marker' }]);
});

it('does not match a name with a different kind', () => {
 const old = rename(scene, 'marker', { id: 'old-marker', name: 'camera_close' });
 const imported = ok(importBlueprint(exportBlueprint(graph([toggle('hide', 'old-marker')]), old), scene, ids()));
 expect(imported.report.missing).toEqual([{ name: 'camera_close', kind: 'mesh', id: 'old-marker', nodeIds: ['hide'] }]);
});

it('treats two name matches as missing and imports the graph disabled', () => {
 const old = rename(scene, 'camera_wide', { id: 'old-camera' });
 const file = exportBlueprint(graph([manual, cut('cut', 'old-camera')], [wire('w', 'run', 'cut')]), old);
 const twin = rename(scene, 'camera_close', { name: 'camera_wide' });
 const imported = ok(importBlueprint(file, twin, ids()));
 expect(imported.graph.nodes[1]).toMatchObject({ settings: { cameraId: 'old-camera' } });
 expect(imported.graph.enabled).toBe(false);
 expect(imported.report).toMatchObject({ enabled: false, missing: [{ name: 'camera_wide', kind: 'camera', id: 'old-camera', nodeIds: ['cut'] }] });
 expect(ok(importBlueprint(file, scene, ids())).report.remapped).toEqual([{ name: 'camera_wide', kind: 'camera', from: 'old-camera', to: 'camera_wide' }]);
});

it('resolves a value used by two field kinds once and changes both fields', () => {
 const old = rename(scene, 'camera_close', { id: 'old-close' });
 const file = exportBlueprint(graph([manual, cut('cut', 'old-close'), toggle('hide', 'old-close')], [wire('w1', 'run', 'cut'), wire('w2', 'cut', 'hide')]), old);
 const imported = ok(importBlueprint(file, scene, ids()));
 expect(imported.graph.nodes.map(n => n.settings)).toEqual([{}, { outputId: 'preview_main', cameraId: 'camera_close' }, { entityId: 'camera_close' }]);
 expect(imported.report.remapped).toHaveLength(1);
});

it('matches a value without a reference entry by ID only, and ignores unused entries', () => {
 const file = { ...exportBlueprint(graph([toggle('hide', 'marker'), toggle('ghost', 'nobody')]), scene), references: [{ id: 'unused', kind: 'mesh', name: 'marker' }] };
 const imported = ok(importBlueprint(file, scene, ids()));
 expect(imported.report.remapped).toEqual([]);
 expect(imported.report.missing).toEqual([{ name: 'nobody', kind: 'unknown', id: 'nobody', nodeIds: ['ghost'] }]);
});

it('keeps a disabled graph disabled', () => {
 const imported = ok(importBlueprint(exportBlueprint({ ...sample, enabled: false }, scene), scene, ids()));
 expect(imported.report.enabled).toBe(false);
});
