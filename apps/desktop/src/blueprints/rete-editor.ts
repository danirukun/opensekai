import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { Presets, SveltePlugin, type SvelteArea2D } from 'rete-svelte-plugin/5';
import { BLUEPRINT_LABELS, blueprintPorts, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type BlueprintOp, type PortType } from '@opensekai/contracts';
import { graphPatch } from './graph-patch';

export { graphPatch } from './graph-patch';
export type BlueprintKind = BlueprintNode['type'];

const sockets: Record<PortType, ClassicPreset.Socket> = {
 flow: new ClassicPreset.Socket('Flow'),
 number: new ClassicPreset.Socket('Number'),
 boolean: new ClassicPreset.Socket('Boolean'),
};

class GraphNode extends ClassicPreset.Node {
 data: BlueprintNode;
 constructor(data: BlueprintNode) {
  super(BLUEPRINT_LABELS[data.type]);
  this.id = data.id;
  this.data = data;
  this.syncPorts();
 }
 // Flow inputs take many wires and flow outputs one; data inputs take one wire and data outputs many.
 syncPorts() {
  const ports = blueprintPorts(this.data);
  for (const name of Object.keys(this.inputs)) if (!Object.hasOwn(ports.inputs, name)) this.removeInput(name);
  for (const name of Object.keys(this.outputs)) if (!Object.hasOwn(ports.outputs, name)) this.removeOutput(name);
  for (const [name, type] of Object.entries(ports.inputs)) if (!Object.hasOwn(this.inputs, name)) this.addInput(name, new ClassicPreset.Input(sockets[type], name, type === 'flow'));
  for (const [name, type] of Object.entries(ports.outputs)) if (!Object.hasOwn(this.outputs, name)) this.addOutput(name, new ClassicPreset.Output(sockets[type], name, type !== 'flow'));
 }
}
type Schemes = GetSchemes<ClassicPreset.Node, ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>>;
type AreaExtra = SvelteArea2D<Schemes>;

export interface ReteBlueprintEditor {
 center(): { x: number; y: number };
 show(graph: BlueprintGraph): Promise<void>;
 select(nodeId: string | null): void;
 zoomToFit(): Promise<void>;
 destroy(): void;
}
export interface ReteBlueprintHandlers { onSelect(id: string | null): void; onOps(ops: BlueprintOp[]): void }

export async function mountReteBlueprint(container: HTMLElement, initial: BlueprintGraph, handlers: ReteBlueprintHandlers): Promise<ReteBlueprintEditor> {
 const editor = new NodeEditor<Schemes>();
 const area = new AreaPlugin<Schemes, AreaExtra>(container);
 const render = new SveltePlugin<Schemes, AreaExtra>();
 const connections = new ConnectionPlugin<Schemes, AreaExtra>();
 render.addPreset(Presets.classic.setup());
 connections.addPreset(ConnectionPresets.classic.setup());
 editor.use(area);
 area.use(render);
 area.use(connections);
 const selectable = AreaExtensions.selectableNodes(area, AreaExtensions.selector(), { accumulating: AreaExtensions.accumulateOnCtrl() });
 let shown: BlueprintGraph = { ...initial, nodes: [], connections: [] };
 let suppress = 0, queue: Promise<void> = Promise.resolve(), destroyed = false;
 const graphId = initial.id;

 area.addPipe(context => {
  if (context.type === 'nodepicked') handlers.onSelect(context.data.id);
  if (context.type === 'nodetranslated' && !suppress) {
   const { id, position } = context.data;
   shown = { ...shown, nodes: shown.nodes.map(node => node.id === id ? { ...node, position: { ...position } } : node) };
   handlers.onOps([{ kind: 'moveNode', graphId, nodeId: id, position: { ...position } }]);
  }
  return context;
 });
 editor.addPipe(context => {
  if (suppress) return context;
  if (context.type === 'connectioncreated') {
   const c = context.data;
   const wire: BlueprintConnection = { id: c.id, sourceNodeId: c.source, sourcePort: String(c.sourceOutput), targetNodeId: c.target, targetPort: String(c.targetInput) };
   shown = { ...shown, connections: [...shown.connections.filter(item => item.id !== wire.id), wire] };
   handlers.onOps([{ kind: 'connect', graphId, connection: wire }]);
  }
  if (context.type === 'connectionremoved') {
   const id = context.data.id;
   shown = { ...shown, connections: shown.connections.filter(item => item.id !== id) };
   handlers.onOps([{ kind: 'disconnect', graphId, connectionId: id }]);
  }
  return context;
 });

 const addNode = async (data: BlueprintNode) => {
  await editor.addNode(new GraphNode(data));
  await area.translate(data.id, data.position);
 };
 const addWire = async (wire: BlueprintConnection) => {
  const source = editor.getNode(wire.sourceNodeId), target = editor.getNode(wire.targetNodeId);
  if (!source || !target || !Object.hasOwn(source.outputs, wire.sourcePort) || !Object.hasOwn(target.inputs, wire.targetPort)) return;
  const connection = new ClassicPreset.Connection(source, wire.sourcePort, target, wire.targetPort);
  connection.id = wire.id;
  await editor.addConnection(connection);
 };
 const removeWire = async (id: string) => { if (editor.getConnection(id)) await editor.removeConnection(id); };
 const updateNode = async (data: BlueprintNode) => {
  const node = editor.getNode(data.id) as GraphNode | undefined;
  if (!node) return;
  const ports = blueprintPorts(data);
  // A wire on a port that no longer exists must leave the canvas before the port does.
  for (const c of editor.getConnections()) {
   if ((c.source === data.id && !Object.hasOwn(ports.outputs, String(c.sourceOutput))) || (c.target === data.id && !Object.hasOwn(ports.inputs, String(c.targetInput)))) await removeWire(c.id);
  }
  node.data = data;
  node.syncPorts();
  await area.update('node', data.id);
 };
 const apply = async (graph: BlueprintGraph) => {
  if (destroyed) return;
  const patch = graphPatch(shown, graph);
  const oldTypes = new Map(shown.nodes.map(node => [node.id, node.type] as const));
  suppress++;
  try {
   for (const id of patch.removeConnections) await removeWire(id);
   for (const id of patch.removeNodes) if (editor.getNode(id)) await editor.removeNode(id);
   const retyped = new Set<string>();
   for (const node of patch.addNodes) await addNode(node);
   for (const node of patch.updateNodes) {
    if (oldTypes.get(node.id) === node.type) { await updateNode(node); continue; }
    retyped.add(node.id);
    for (const c of editor.getConnections()) if (c.source === node.id || c.target === node.id) await removeWire(c.id);
    await editor.removeNode(node.id);
    await addNode(node);
   }
   for (const move of patch.moveNodes) await area.translate(move.id, move.position);
   const added = new Set(patch.addConnections.map(wire => wire.id));
   const again = graph.connections.filter(wire => !added.has(wire.id) && (retyped.has(wire.sourceNodeId) || retyped.has(wire.targetNodeId)));
   for (const wire of [...patch.addConnections, ...again]) await addWire(wire);
   shown = graph;
  } finally { suppress--; }
 };
 const show = (graph: BlueprintGraph) => (queue = queue.then(() => apply(graph)).catch(() => undefined));

 await show(initial);
 await AreaExtensions.zoomAt(area, editor.getNodes());
 return {
  center() {
   const { x, y, k } = area.area.transform;
   return { x: Math.round((container.clientWidth / 2 - x) / k - 90), y: Math.round((container.clientHeight / 2 - y) / k - 40) };
  },
  show,
  select(nodeId) {
   if (nodeId === null) { for (const node of editor.getNodes()) selectable.unselect(node.id); return; }
   if (editor.getNode(nodeId)) selectable.select(nodeId, false);
  },
  zoomToFit: () => AreaExtensions.zoomAt(area, editor.getNodes()),
  destroy() { destroyed = true; area.destroy(); },
 };
}
