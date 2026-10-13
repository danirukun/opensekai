import { exportBlueprint, keystrokeAccelerator, makeSmokeScene, serializeBlueprintFile, type BlueprintFile, type BlueprintGraph, type KeystrokeSettings, type SceneView } from '../src';

const at = (x: number, y: number) => ({ x, y });
const node = (id: string, type: string, settings: object, x = 0, y = 0) => ({ id, version: 1, type, settings, position: at(x, y) });
const num = (id: string, value: number, x = 0, y = 0) => node(id, 'value.number', { value }, x, y);
const wire = (sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) =>
 ({ id: `${sourceNodeId}.${sourcePort}-${targetNodeId}.${targetPort}`, sourceNodeId, sourcePort, targetNodeId, targetPort });
const graph = (file: string, name: string, nodes: unknown[], connections: unknown[], variables: unknown[] = []): BlueprintGraph =>
 ({ schemaVersion: 1, id: `fixture-${file}`, name, enabled: true, nodes, connections, variables } as BlueprintGraph);
export const hotkey = (code: string): KeystrokeSettings => ({ code, control: true, alt: true, shift: false, meta: false } as KeystrokeSettings);
export const accelerator = (code: string) => keystrokeAccelerator(hotkey(code));
const renamed = (scene: SceneView, id: string, next: { id?: string; name?: string }): SceneView =>
 ({ ...scene, entities: scene.entities.map(e => e.id === id ? { ...e, ...next } : e) } as SceneView);
export const twinScene = () => renamed(makeSmokeScene(), 'camera_close', { name: 'camera_wide' });

const nudgeNodes = (entityId: string) => [
 node('run', 'event.manual', {}, 0, 0),
 num('x', 0.2, 0, 120), num('y', 1.1, 0, 200), num('z', -0.5, 0, 280),
 node('make', 'vector3.make', {}, 240, 160),
 node('set', 'property.set', { entityId, property: 'position' }, 480, 0),
];
const nudgeWires = [wire('x', 'value', 'make', 'x'), wire('y', 'value', 'make', 'y'), wire('z', 'value', 'make', 'z'), wire('make', 'value', 'set', 'value'), wire('run', 'flow', 'set', 'flow')];
const smoke = makeSmokeScene();
const nudge = exportBlueprint(graph('nudge', 'Nudge', nudgeNodes('reference'), nudgeWires), smoke);

const valid: Record<string, BlueprintFile> = {
 nudge,
 drift: exportBlueprint(graph('drift', 'Drift', [
  node('tick', 'event.update', {}, 0, 0),
  num('speed', 0.5, 0, 120), num('zero', 0, 0, 200),
  node('make', 'vector3.make', {}, 240, 120),
  node('scale', 'vector3.scale', {}, 480, 120),
  node('move', 'entity.move', { entityId: 'reference', space: 'world' }, 720, 0),
 ], [wire('speed', 'value', 'make', 'x'), wire('zero', 'value', 'make', 'y'), wire('zero', 'value', 'make', 'z'), wire('make', 'value', 'scale', 'value'), wire('tick', 'deltaSeconds', 'scale', 'factor'), wire('scale', 'result', 'move', 'delta'), wire('tick', 'flow', 'move', 'flow')]), smoke),
 wasd: exportBlueprint(graph('wasd', 'WASD', [
  node('tick', 'event.update', {}, 0, 0),
  node('ax', 'input.keyAxis', { negative: 'KeyD', positive: 'KeyA' }, 0, 120),
  node('az', 'input.keyAxis', { negative: 'KeyS', positive: 'KeyW' }, 0, 200),
  num('zero', 0, 0, 280), num('speed', 1.5, 0, 360),
  node('dir', 'vector3.make', {}, 240, 160),
  node('rate', 'math.multiply', {}, 240, 320),
  node('step', 'vector3.scale', {}, 480, 200),
  node('move', 'entity.move', { entityId: 'performer', space: 'local' }, 720, 0),
 ], [wire('ax', 'value', 'dir', 'x'), wire('zero', 'value', 'dir', 'y'), wire('az', 'value', 'dir', 'z'), wire('speed', 'value', 'rate', 'a'), wire('tick', 'deltaSeconds', 'rate', 'b'), wire('dir', 'value', 'step', 'value'), wire('rate', 'result', 'step', 'factor'), wire('step', 'result', 'move', 'delta'), wire('tick', 'flow', 'move', 'flow')]), smoke),
 'camera-flip': exportBlueprint(graph('camera-flip', 'Camera Flip', [
  node('key', 'event.keystroke', hotkey('KeyH'), 0, 0),
  node('flip', 'flow.flipFlop', {}, 240, 0),
  node('close', 'camera.switch', { outputId: 'preview_main', cameraId: 'camera_close' }, 480, 0),
  node('wide', 'camera.switch', { outputId: 'preview_main', cameraId: 'camera_wide' }, 480, 120),
 ], [wire('key', 'flow', 'flip', 'flow'), wire('flip', 'a', 'close', 'flow'), wire('flip', 'b', 'wide', 'flow')]), smoke),
 counter: exportBlueprint(graph('counter', 'Counter', [
  node('key', 'event.keystroke', hotkey('KeyJ'), 0, 0),
  num('one', 1, 0, 120),
  node('add', 'variable.addNumber', { variableId: 'count' }, 240, 0),
  node('get', 'variable.getNumber', { variableId: 'count' }, 240, 120),
  node('pick', 'flow.switch', { cases: [1, 2] }, 480, 0),
  node('close', 'camera.switch', { outputId: 'preview_main', cameraId: 'camera_close' }, 720, 0),
  node('wide', 'camera.switch', { outputId: 'preview_main', cameraId: 'camera_wide' }, 720, 120),
 ], [wire('key', 'flow', 'add', 'flow'), wire('one', 'value', 'add', 'amount'), wire('add', 'exit', 'pick', 'flow'), wire('get', 'value', 'pick', 'value'), wire('pick', 'case0', 'close', 'flow'), wire('pick', 'case1', 'wide', 'flow')],
 [{ id: 'count', name: 'Count', type: 'number', default: 0 }]), smoke),
 'renamed-ids': exportBlueprint(graph('renamed-ids', 'Renamed IDs', nudgeNodes('old-reference'), nudgeWires), renamed(smoke, 'reference', { id: 'old-reference' })),
 'missing-ref': exportBlueprint(graph('missing-ref', 'Missing Reference', [
  node('run', 'event.manual', {}, 0, 0),
  node('hide', 'scene.toggleVisibility', { entityId: 'ghost' }, 240, 0),
 ], [wire('run', 'flow', 'hide', 'flow')]), renamed(smoke, 'marker', { id: 'ghost', name: 'Ghost' })),
 'ambiguous-ref': exportBlueprint(graph('ambiguous-ref', 'Ambiguous Reference', [
  node('run', 'event.manual', {}, 0, 0),
  node('cut', 'camera.switch', { outputId: 'preview_main', cameraId: 'old-camera' }, 240, 0),
 ], [wire('run', 'flow', 'cut', 'flow')]), renamed(smoke, 'camera_wide', { id: 'old-camera' })),
};

// A small hand-made file in the shape of a Warudo Blueprint. It has no Warudo content.
const warudoShaped = {
 id: '00000000-0000-4000-8000-000000000001', enabled: true, name: 'Warudo Shaped', panningX: 0, panningY: 0, scaling: 1,
 nodes: { '00000000-0000-4000-8000-000000000002': { id: '00000000-0000-4000-8000-000000000002', dataInputs: {}, typeId: '00000000-0000-4000-8000-000000000003', name: 'ON_UPDATE', x: 0, y: 0 } },
 dataConnections: [], flowConnections: [], properties: { id: '00000000-0000-4000-8000-000000000004', dataInputs: {} },
};

export const FIXTURE_TEXT: Record<string, string> = {
 ...Object.fromEntries(Object.entries(valid).map(([name, file]) => [name, serializeBlueprintFile(file)])),
 'future-version': serializeBlueprintFile({ ...nudge, formatVersion: 2 } as unknown as BlueprintFile),
 'unknown-node': serializeBlueprintFile({ ...nudge, graph: { ...nudge.graph, nodes: [...nudge.graph.nodes, node('wave', 'character.wave', {}, 720, 0)] } } as unknown as BlueprintFile),
 'warudo-shaped': `${JSON.stringify(warudoShaped, null, 2)}\n`,
};
export const VALID_FIXTURES = Object.keys(valid);
export const FIXTURE_NAMES = Object.keys(FIXTURE_TEXT);
