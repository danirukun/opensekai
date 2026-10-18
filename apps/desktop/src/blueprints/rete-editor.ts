import type { Component } from 'svelte';
import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { getDOMSocketPosition } from 'rete-render-utils';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { Presets, SveltePlugin, type SvelteArea2D } from 'rete-svelte-plugin/5';
import { BLUEPRINT_LABELS, blueprintPorts, connectionType, DATA_TYPE_LABELS, DATA_TYPES, ownPort, withInlineInput, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type BlueprintOp, type PortType, type ScalarValue } from '@opensekai/contracts';
import { graphPatch } from './graph-patch';

export { graphPatch } from './graph-patch';
export type BlueprintKind = BlueprintNode['type'];

// The socket view reads `kind` for its appearance and `name` for its title.
class TypedSocket extends ClassicPreset.Socket {
 kind: PortType;
 constructor(kind: PortType) { super(kind === 'flow' ? 'Flow' : DATA_TYPE_LABELS[kind]); this.kind = kind; }
}
const sockets = Object.fromEntries((['flow', ...DATA_TYPES] as const).map(kind => [kind, new TypedSocket(kind)])) as Record<PortType, TypedSocket>;

export type InlineEdit = (port: string, value: ScalarValue | null) => void;
class GraphNode extends ClassicPreset.Node {
 data: BlueprintNode;
 // Inputs with a wire; the node view shows an inline editor on the other scalar data inputs.
 wired = new Set<string>();
 setInput: InlineEdit;
 constructor(data: BlueprintNode, setInput: InlineEdit) {
  super(BLUEPRINT_LABELS[data.type]);
  this.id = data.id;
  this.data = data;
  this.setInput = setInput;
  this.syncPorts();
 }
 // Flow inputs take many wires and flow outputs one; data inputs take one wire and data outputs many.
 syncPorts() {
  const ports = blueprintPorts(this.data);
  // A port whose type changed is removed here and added again below with its new socket.
  for (const name of Object.keys(this.inputs)) { const type = ownPort(ports, 'inputs', name); if (!type || this.inputs[name]!.socket !== sockets[type]) this.removeInput(name); }
  for (const name of Object.keys(this.outputs)) { const type = ownPort(ports, 'outputs', name); if (!type || this.outputs[name]!.socket !== sockets[type]) this.removeOutput(name); }
  for (const [name, type] of Object.entries(ports.inputs)) if (!Object.hasOwn(this.inputs, name)) this.addInput(name, new ClassicPreset.Input(sockets[type], name, type === 'flow'));
  for (const [name, type] of Object.entries(ports.outputs)) if (!Object.hasOwn(this.outputs, name)) this.addOutput(name, new ClassicPreset.Output(sockets[type], name, type !== 'flow'));
  // Ports keep the definition's order, also when a settings change adds one (a new Switch case goes before default).
  Object.keys(ports.inputs).forEach((name, index) => { this.inputs[name]!.index = index; });
  Object.keys(ports.outputs).forEach((name, index) => { this.outputs[name]!.index = index; });
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
export interface BlueprintViews { node: Component<any>; socket: Component<any>; connection: Component<any> }
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
 const views = options.views;
 // Wires end at the socket center: the custom sockets are small, so the classic 12 px offset would leave a gap.
 render.addPreset(Presets.classic.setup(views ? { socketPositionWatcher: getDOMSocketPosition({ offset: position => position }), customize: { node: () => views.node, socket: () => views.socket, connection: () => views.connection } } : undefined));
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
  // New wires go behind every node, so a wire never covers a node's ports or labels.
  if (context.type === 'connectioncreated') {
   const view = area.connectionViews.get(context.data.id);
   if (view) void area.area.content.reorder(view.element, area.area.content.holder.firstChild);
  }
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
  if (context.type === 'connectioncreated' || context.type === 'connectionremoved') rewire(context.data.target);
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
 // An inline edit changes the canvas copy first, so the echo of the session needs no redraw.
 const setInput = (nodeId: string): InlineEdit => (port, value) => {
  const node = editor.getNode(nodeId) as GraphNode | undefined;
  if (destroyed || !node) return;
  node.data = withInlineInput(node.data, port, value);
  track(graph => ({ ...graph, nodes: graph.nodes.map(item => item.id === nodeId ? withInlineInput(item, port, value) : item) }));
  void area.update('node', nodeId);
  handlers.onOps([{ kind: 'setNodeInput', graphId, nodeId, port, value }]);
 };
 const rewire = (nodeId: string) => {
  const node = editor.getNode(nodeId) as GraphNode | undefined;
  if (!node) return;
  node.wired = new Set(editor.getConnections().filter(c => c.target === nodeId).map(c => String(c.targetInput)));
  void area.update('node', nodeId);
 };
 const addNode = (data: BlueprintNode) => ownNode(data.id, async () => {
  await editor.addNode(new GraphNode(data, setInput(data.id)));
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
  // A wire on a port that is gone or retyped must leave the canvas before the port does.
  for (const c of editor.getConnections()) {
   if (c.source !== data.id && c.target !== data.id) continue;
   const source = c.source === data.id ? data : (editor.getNode(c.source) as GraphNode | undefined)?.data;
   const target = c.target === data.id ? data : (editor.getNode(c.target) as GraphNode | undefined)?.data;
   if (!source || !target || !connectionType(source, String(c.sourceOutput), target, String(c.targetInput))) await removeWire(c.id);
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
