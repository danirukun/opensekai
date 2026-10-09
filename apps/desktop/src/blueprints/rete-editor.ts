import type { Component } from 'svelte';
import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { Presets, SveltePlugin, type SvelteArea2D } from 'rete-svelte-plugin/5';
import { BLUEPRINT_LABELS, blueprintPorts, ownPort, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type BlueprintOp, type PortType } from '@opensekai/contracts';
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
  for (const name of Object.keys(this.inputs)) if (!ownPort(ports, 'inputs', name)) this.removeInput(name);
  for (const name of Object.keys(this.outputs)) if (!ownPort(ports, 'outputs', name)) this.removeOutput(name);
  for (const [name, type] of Object.entries(ports.inputs)) if (!Object.hasOwn(this.inputs, name)) this.addInput(name, new ClassicPreset.Input(sockets[type], name, type === 'flow'));
  for (const [name, type] of Object.entries(ports.outputs)) if (!Object.hasOwn(this.outputs, name)) this.addOutput(name, new ClassicPreset.Output(sockets[type], name, type !== 'flow'));
 }
}
type Schemes = GetSchemes<ClassicPreset.Node, ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>>;
type AreaExtra = SvelteArea2D<Schemes>;

export type MenuTarget = { kind: 'canvas' } | { kind: 'node'; nodeId: string } | { kind: 'wire'; connectionId: string };
export interface ReteBlueprintEditor {
 selected(): string[];
 selectMany(ids: string[]): void;
 pointer(): { x: number; y: number };
 center(): { x: number; y: number };
 show(graph: BlueprintGraph): Promise<void>;
 select(nodeId: string | null): void;
 zoomToFit(): Promise<void>;
 destroy(): void;
}
// Svelte components for nodes and sockets; the panel passes them so this module stays free of .svelte imports.
export interface BlueprintViews { node: Component<any>; socket: Component<any> }
export interface ReteBlueprintHandlers {
 onSelect(id: string | null): void; onOps(ops: BlueprintOp[]): void;
 onContextMenu?(target: MenuTarget, client: { x: number; y: number }): void;
 onWireDrop?(from: { nodeId: string; port: string; side: 'input' | 'output' }, client: { x: number; y: number }): void;
}

export async function mountReteBlueprint(container: HTMLElement, initial: BlueprintGraph, handlers: ReteBlueprintHandlers, options: { render?: boolean; inspect?: (area: AreaPlugin<Schemes, AreaExtra>) => void; views?: BlueprintViews } = {}): Promise<ReteBlueprintEditor> {
 const editor = new NodeEditor<Schemes>();
 const area = new AreaPlugin<Schemes, AreaExtra>(container);
 const render = new SveltePlugin<Schemes, AreaExtra>();
 const connections = new ConnectionPlugin<Schemes, AreaExtra>();
 render.addPreset(Presets.classic.setup(options.views ? { customize: { node: () => options.views!.node, socket: () => options.views!.socket } } : undefined));
 connections.addPreset(ConnectionPresets.classic.setup());
 connections.addPipe(context => {
  if (context.type === 'connectiondrop' && !context.data.created && context.data.socket === null) {
   const { nodeId, key, side } = context.data.initial;
   const { x, y } = area.area.pointer, { k, x: tx, y: ty } = area.area.transform, box = container.getBoundingClientRect();
   handlers.onWireDrop?.({ nodeId, port: key, side }, { x: box.left + x * k + tx, y: box.top + y * k + ty });
  }
  return context;
 });
 editor.use(area);
 if (options.render !== false) { area.use(render); area.use(connections); }
 // This pipe must stay after `area.use(connections)` so the connection plugin still receives every pointerup.
 // The selection extension clears on any pointerup it sees as a click; only the primary button may reach it.
 area.addPipe(context => (context.type === 'pointerdown' || context.type === 'pointerup') && context.data.event.button !== 0 ? undefined : context);
 const selector = AreaExtensions.selector();
 const selectable = AreaExtensions.selectableNodes(area, selector, { accumulating: AreaExtensions.accumulateOnCtrl() });
 options.inspect?.(area);
 let shown: BlueprintGraph = { ...initial, nodes: [], connections: [] };
 let queue: Promise<void> = Promise.resolve(), destroyed = false, applying = false, silent = false, dirty = false;
 let targeted: MouseEvent | null = null;
 // Events that apply() itself causes are named here only while its own awaited call runs, so a user gesture during a patch still counts.
 const ownNodes = new Set<string>(), ownWires = new Set<string>();
 let log: ((graph: BlueprintGraph) => BlueprintGraph)[] = [];
 const graphId = initial.id;
 const track = (change: (graph: BlueprintGraph) => BlueprintGraph) => { shown = change(shown); if (applying) log.push(change); };

 area.addPipe(context => {
  if (context.type === 'nodepicked') handlers.onSelect(context.data.id);
  if (context.type === 'nodetranslated' && !silent && !ownNodes.has(context.data.id)) {
   const { id, position } = context.data;
   track(graph => ({ ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, position: { ...position } } : node) }));
   handlers.onOps([{ kind: 'moveNode', graphId, nodeId: id, position: { ...position } }]);
  }
  if (context.type === 'contextmenu') {
   const { event, context: hit } = context.data as { event: MouseEvent; context: 'root' | { id: string; source?: string; target?: string } };
   event.preventDefault();
   // A right-click on a node or wire bubbles to the canvas with the same event; report only the first.
   if (hit === 'root' && event === targeted) return context;
   if (hit !== 'root') targeted = event;
   const target: MenuTarget = hit === 'root' ? { kind: 'canvas' } : 'source' in hit && 'target' in hit ? { kind: 'wire', connectionId: hit.id } : { kind: 'node', nodeId: hit.id };
   handlers.onContextMenu?.(target, { x: event.clientX, y: event.clientY });
  }
  return context;
 });
 editor.addPipe(context => {
  if (silent) return context;
  if (context.type === 'connectioncreated' && !ownWires.has(context.data.id)) {
   const c = context.data;
   const wire: BlueprintConnection = { id: c.id, sourceNodeId: c.source, sourcePort: String(c.sourceOutput), targetNodeId: c.target, targetPort: String(c.targetInput) };
   track(graph => ({ ...graph, connections: [...graph.connections.filter(item => item.id !== wire.id), wire] }));
   handlers.onOps([{ kind: 'connect', graphId, connection: wire }]);
  }
  if (context.type === 'connectionremoved' && !ownWires.has(context.data.id)) {
   const id = context.data.id;
   track(graph => ({ ...graph, connections: graph.connections.filter(item => item.id !== id) }));
   handlers.onOps([{ kind: 'disconnect', graphId, connectionId: id }]);
  }
  return context;
 });

 // NodeView translates to (0,0) on creation, so a node is own from before addNode until after its placement.
 const ownNode = async (id: string, work: () => Promise<unknown>) => {
  const nested = ownNodes.has(id);
  ownNodes.add(id);
  try { await work(); } finally { if (!nested) ownNodes.delete(id); }
 };
 const place = (id: string, position: BlueprintNode['position']) => ownNode(id, () => area.translate(id, position));
 const addNode = (data: BlueprintNode) => ownNode(data.id, async () => {
  await editor.addNode(new GraphNode(data));
  await place(data.id, data.position);
 });
 const addWire = async (wire: BlueprintConnection) => {
  const source = editor.getNode(wire.sourceNodeId), target = editor.getNode(wire.targetNodeId);
  if (!source || !target || !Object.hasOwn(source.outputs, wire.sourcePort) || !Object.hasOwn(target.inputs, wire.targetPort)) return;
  const connection = new ClassicPreset.Connection(source, wire.sourcePort, target, wire.targetPort);
  connection.id = wire.id;
  ownWires.add(wire.id);
  try { await editor.addConnection(connection); } finally { ownWires.delete(wire.id); }
 };
 const removeWire = async (id: string) => {
  if (!editor.getConnection(id)) return;
  ownWires.add(id);
  try { await editor.removeConnection(id); } finally { ownWires.delete(id); }
 };
 const updateNode = async (data: BlueprintNode) => {
  const node = editor.getNode(data.id) as GraphNode | undefined;
  if (!node) return;
  const ports = blueprintPorts(data);
  // A wire on a port that no longer exists must leave the canvas before the port does.
  for (const c of editor.getConnections()) {
   if ((c.source === data.id && !ownPort(ports, 'outputs', String(c.sourceOutput))) || (c.target === data.id && !ownPort(ports, 'inputs', String(c.targetInput)))) await removeWire(c.id);
  }
  node.data = data;
  node.syncPorts();
  await area.update('node', data.id);
 };
 const rebuild = async (graph: BlueprintGraph) => {
  await editor.clear();
  for (const node of graph.nodes) await addNode(node);
  for (const wire of graph.connections) await addWire(wire);
 };
 const apply = async (graph: BlueprintGraph) => {
  if (destroyed) return;
  const patch = graphPatch(shown, graph);
  const oldTypes = new Map(shown.nodes.map(node => [node.id, node.type] as const));
  applying = true; log = [];
  try {
   if (dirty) throw new Error('canvas out of sync');
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
   for (const move of patch.moveNodes) await place(move.id, move.position);
   const added = new Set(patch.addConnections.map(wire => wire.id));
   const again = graph.connections.filter(wire => !added.has(wire.id) && (retyped.has(wire.sourceNodeId) || retyped.has(wire.targetNodeId)));
   for (const wire of [...patch.addConnections, ...again]) await addWire(wire);
  } catch {
   // A partial patch leaves the canvas unknown, so rebuild it from the target graph.
   silent = true; log = [];
   try { await rebuild(graph); dirty = false; } catch { dirty = true; } finally { silent = false; }
  } finally { applying = false; }
  shown = log.reduce((current, change) => change(current), graph);
  log = [];
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
  selected: () => [...selector.entities.values()].filter(entity => entity.label === 'node').map(entity => entity.id),
  selectMany(ids) { ids.forEach((id, i) => { if (editor.getNode(id)) selectable.select(id, i > 0); }); },
  pointer: () => ({ x: Math.round(area.area.pointer.x), y: Math.round(area.area.pointer.y) }),
  select(nodeId) {
   if (nodeId === null) { for (const node of editor.getNodes()) selectable.unselect(node.id); return; }
   if (editor.getNode(nodeId)) selectable.select(nodeId, false);
  },
  zoomToFit: () => AreaExtensions.zoomAt(area, editor.getNodes()),
  destroy() { destroyed = true; area.destroy(); },
 };
}
