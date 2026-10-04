import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { Presets, SveltePlugin, type SvelteArea2D } from 'rete-svelte-plugin/5';
import type { BlueprintGraph, BlueprintNode } from '@opensekai/contracts';

export type BlueprintKind = BlueprintNode['type'];
const labels: Record<BlueprintKind, string> = {
 'event.manual': 'Manual Trigger', 'value.number': 'Number', 'value.boolean': 'Boolean',
 'math.add': 'Add', 'logic.greater': 'Greater Than', 'scene.setVisibility': 'Set Visibility',
};
const portTypes = {
 'event.manual': { inputs: {}, outputs: { flow: 'flow' } },
 'value.number': { inputs: {}, outputs: { value: 'number' } },
 'value.boolean': { inputs: {}, outputs: { value: 'boolean' } },
 'math.add': { inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } },
 'logic.greater': { inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } },
 'scene.setVisibility': { inputs: { flow: 'flow', visible: 'boolean' }, outputs: {} },
} as const;
const sockets = {
 flow: new ClassicPreset.Socket('Flow'),
 number: new ClassicPreset.Socket('Number'),
 boolean: new ClassicPreset.Socket('Boolean'),
};
type Settings = BlueprintNode['settings'];

class GraphNode extends ClassicPreset.Node {
 kind: BlueprintKind;
 settings: Settings;
 constructor(kind: BlueprintKind, settings: Settings) {
  super(labels[kind]);
  this.kind = kind;
  this.settings = settings;
  const ports = portTypes[kind] as { inputs: Record<string, keyof typeof sockets>; outputs: Record<string, keyof typeof sockets> };
  for (const [name, type] of Object.entries(ports.inputs)) this.addInput(name, new ClassicPreset.Input(sockets[type], name));
  for (const [name, type] of Object.entries(ports.outputs)) this.addOutput(name, new ClassicPreset.Output(sockets[type], name));
 }
}
type Schemes = GetSchemes<ClassicPreset.Node, ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>>;
type AreaExtra = SvelteArea2D<Schemes>;

const settingsFor = (kind: BlueprintKind, entityId: string): Settings => {
 if (kind === 'value.number') return { value: 0 };
 if (kind === 'value.boolean') return { value: true };
 if (kind === 'scene.setVisibility') return { entityId };
 return {};
};

export function initialBlueprint(entityId: string): BlueprintGraph {
 const make = (id: string, type: BlueprintKind, x: number, y: number): BlueprintNode => ({ id, version: 1, type, settings: settingsFor(type, entityId), position: { x, y } } as BlueprintNode);
 const nodes = [make(crypto.randomUUID(), 'event.manual', 50, 95), make(crypto.randomUUID(), 'value.boolean', 50, 310), make(crypto.randomUUID(), 'scene.setVisibility', 370, 180)];
 return {
  schemaVersion: 1, id: crypto.randomUUID(), name: 'Blueprint draft',
  nodes,
  connections: [
   { id: crypto.randomUUID(), sourceNodeId: nodes[0]!.id, sourcePort: 'flow', targetNodeId: nodes[2]!.id, targetPort: 'flow' },
   { id: crypto.randomUUID(), sourceNodeId: nodes[1]!.id, sourcePort: 'value', targetNodeId: nodes[2]!.id, targetPort: 'visible' },
  ],
 };
}

export interface ReteBlueprintEditor {
 add(kind: BlueprintKind, entityId: string): Promise<string>;
 remove(id: string): Promise<void>;
 setSettings(id: string, settings: Settings): void;
 read(): BlueprintGraph;
 destroy(): void;
}

export async function mountReteBlueprint(container: HTMLElement, draft: BlueprintGraph, onSelect: (id: string | null) => void): Promise<ReteBlueprintEditor> {
 const editor = new NodeEditor<Schemes>();
 const area = new AreaPlugin<Schemes, AreaExtra>(container);
 const render = new SveltePlugin<Schemes, AreaExtra>();
 const connections = new ConnectionPlugin<Schemes, AreaExtra>();
 render.addPreset(Presets.classic.setup());
 connections.addPreset(ConnectionPresets.classic.setup());
 editor.use(area);
 area.use(render);
 area.use(connections);
 AreaExtensions.selectableNodes(area, AreaExtensions.selector(), { accumulating: AreaExtensions.accumulateOnCtrl() });
 area.addPipe(context => {
  if (context.type === 'nodepicked') onSelect(context.data.id);
  return context;
 });
 const create = async (data: BlueprintNode) => {
  const node = new GraphNode(data.type, data.settings);
  node.id = data.id;
  await editor.addNode(node);
  await area.translate(node.id, data.position);
  return node;
 };
 for (const data of draft.nodes) await create(data);
 for (const wire of draft.connections) {
  const source = editor.getNode(wire.sourceNodeId), target = editor.getNode(wire.targetNodeId);
  if (!source || !target) continue;
  const connection = new ClassicPreset.Connection(source, wire.sourcePort, target, wire.targetPort);
  connection.id = wire.id;
  await editor.addConnection(connection);
 }
 await AreaExtensions.zoomAt(area, editor.getNodes());
 return {
  async add(kind, entityId) {
   const id = crypto.randomUUID();
   const count = editor.getNodes().length;
   await create({ id, version: 1, type: kind, settings: settingsFor(kind, entityId), position: { x: 80 + (count % 4) * 225, y: 100 + Math.floor(count / 4) * 180 } } as BlueprintNode);
   onSelect(id);
   return id;
  },
  async remove(id) {
   for (const connection of editor.getConnections()) if (connection.source === id || connection.target === id) await editor.removeConnection(connection.id);
   await editor.removeNode(id);
   onSelect(null);
  },
  setSettings(id, settings) { const node = editor.getNode(id) as GraphNode | undefined; if (node) node.settings = settings; },
  read() {
   return {
    schemaVersion: 1, id: draft.id, name: draft.name,
    nodes: editor.getNodes().map(value => { const node = value as GraphNode; return { id: node.id, version: 1, type: node.kind, settings: node.settings, position: area.nodeViews.get(node.id)?.position ?? { x: 0, y: 0 } }; }) as BlueprintNode[],
    connections: editor.getConnections().map(connection => ({ id: connection.id, sourceNodeId: connection.source, sourcePort: String(connection.sourceOutput), targetNodeId: connection.target, targetPort: String(connection.targetInput) })),
   };
  },
  destroy() { area.destroy(); },
 };
}
