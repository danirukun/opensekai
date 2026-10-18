import type { Component } from 'svelte';
import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin, Drag } from 'rete-area-plugin';
import { getDOMSocketPosition } from 'rete-render-utils';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { Presets, SveltePlugin, type SvelteArea2D } from 'rete-svelte-plugin/5';
import { BLUEPRINT_LABELS, blueprintPorts, connectionType, DATA_TYPE_LABELS, DATA_TYPES, ownPort, withInlineInput, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type BlueprintOp, type PortType, type ScalarValue } from '@opensekai/contracts';
import { graphPatch } from './graph-patch';
import { applyBlueprintOps, type BlueprintComment } from '@opensekai/contracts';
import { attachBoxSelect } from './box-gesture';
import { boxSelection, type Box, type Rect } from './box-select';
import { createCommentLayer, type CommentLayer, type DragPhase } from './comment-layer';
import { commentMoveOps, nodesInComment } from './comments';
import { DEFAULT_NODE_SIZE, type LayoutSize } from './layout';

export { graphPatch } from './graph-patch';
export type BlueprintKind = BlueprintNode['type'];

// The socket view reads `kind` for its appearance and `name` for its title.
class TypedSocket extends ClassicPreset.Socket {
 kind: PortType;
 constructor(kind: PortType) { super(kind === 'flow' ? 'Flow' : DATA_TYPE_LABELS[kind]); this.kind = kind; }
}
const sockets = Object.fromEntries((['flow', ...DATA_TYPES] as const).map(kind => [kind, new TypedSocket(kind)])) as Record<PortType, TypedSocket>;

export type InlineEdit = (port: string, value: ScalarValue | null) => void;
export interface DebugText { text: string; time: string }
class GraphNode extends ClassicPreset.Node {
 data: BlueprintNode;
 // The wire count of each input with a wire; the node view shows an inline editor on the other scalar data inputs.
 wired = new Map<string, number>();
 // False while the panel is disabled: inline editors are disabled and send nothing.
 editable = true;
 // The latest Debug Value text and the session time it changed (slice F R14).
 debug: DebugText | null = null;
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

export type MenuTarget = { kind: 'canvas' } | { kind: 'node'; nodeId: string } | { kind: 'wire'; connectionId: string } | { kind: 'comment'; commentId: string };
export interface ReteBlueprintEditor {
 selected(): string[];
 selectMany(ids: string[]): void;
 pointer(): { x: number; y: number };
 center(): { x: number; y: number };
 show(graph: BlueprintGraph): Promise<void>;
 select(nodeId: string | null): void;
 setEditable(editable: boolean): void;
 // Debug Value text by node ID; a node without an entry shows none.
 setDebugValues(values: ReadonlyMap<string, DebugText>): void;
 zoomToFit(): Promise<void>;
 destroy(): void;
 selectedComments(): string[];
 selectComments(ids: string[]): void;
 // Node boxes in canvas units, measured from the rendered views.
 boxes(): Box[];
 sizes(): Map<string, LayoutSize>;
}
// Svelte components for nodes and sockets; the panel passes them so this module stays free of .svelte imports.
export interface BlueprintViews { node: Component<any>; socket: Component<any>; connection: Component<any> }
export interface ReteBlueprintHandlers {
 onSelect(id: string | null): void; onOps(ops: BlueprintOp[]): void;
 onContextMenu?(target: MenuTarget, client: { x: number; y: number }): void;
 onWireDrop?(from: { nodeId: string; port: string; side: 'input' | 'output' }, client: { x: number; y: number }): void;
 onCommentSelect?(ids: string[]): void;
 onCommentOpen?(id: string): void;
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
 const accumulating = AreaExtensions.accumulateOnCtrl();
 const selectable = AreaExtensions.selectableNodes(area, selector, { accumulating });
 options.inspect?.(area);
 let shown: BlueprintGraph = { ...initial, nodes: [], connections: [] };
 let debugValues: ReadonlyMap<string, DebugText> = new Map();
 let queue: Promise<void> = Promise.resolve(), destroyed = false, applying = false, silent = false, dirty = false, editable = true;
 let targeted: MouseEvent | null = null;
 // Events that apply() itself causes are named here only while its own awaited call runs, so a user gesture during a patch still counts.
 const ownNodes = new Set<string>(), ownWires = new Set<string>();
 let log: ((graph: BlueprintGraph) => BlueprintGraph)[] = [];
 const graphId = initial.id;
 const track = (change: (graph: BlueprintGraph) => BlueprintGraph) => { shown = change(shown); if (applying) log.push(change); };

 // A click on empty canvas (a press with almost no movement) clears the comment selection, as the selection extension does for nodes.
 let press: { moves: number } | null = null;
 area.addPipe(context => {
  if (context.type === 'nodepicked') { if (!accumulating.active()) clearComments(); handlers.onSelect(context.data.id); }
  if (context.type === 'pointerdown') press = context.data.event.target === container || context.data.event.target === area.area.content.holder ? { moves: 0 } : null;
  if (context.type === 'pointermove' && press) press.moves++;
  if (context.type === 'pointerup') { if (press && press.moves < 4) clearComments(); press = null; }
  // New wires go behind every node, so a wire never covers a node's ports or labels.
  if (context.type === 'connectioncreated') {
   const view = area.connectionViews.get(context.data.id);
   if (view) void area.area.content.reorder(view.element, behindNodes());
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
  if (context.type === 'connectioncreated' || context.type === 'connectionremoved') countWire(context.data.target, String(context.data.targetInput), context.type === 'connectioncreated' ? 1 : -1);
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
  if (destroyed || !node || !editable) return;
  node.data = withInlineInput(node.data, port, value);
  track(graph => ({ ...graph, nodes: graph.nodes.map(item => item.id === nodeId ? withInlineInput(item, port, value) : item) }));
  void area.update('node', nodeId);
  handlers.onOps([{ kind: 'setNodeInput', graphId, nodeId, port, value }]);
 };
 // Only the input of the added or removed wire changes; the node redraws when that input gains its first wire or loses its last.
 const countWire = (nodeId: string, port: string, change: 1 | -1) => {
  const node = editor.getNode(nodeId) as GraphNode | undefined;
  if (!node) return;
  const count = (node.wired.get(port) ?? 0) + change;
  if (count > 0) node.wired.set(port, count); else node.wired.delete(port);
  if (count === 0 || (count === 1 && change === 1)) void area.update('node', nodeId);
 };
 const addNode = (data: BlueprintNode) => ownNode(data.id, async () => {
  const node = new GraphNode(data, setInput(data.id));
  node.editable = editable;
  node.debug = debugValues.get(data.id) ?? null;
  await editor.addNode(node);
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
  comments?.sync(graph.comments ?? []);
  shown = log.reduce((current, change) => change(current), graph);
  log = [];
 };
 const show = (graph: BlueprintGraph) => (queue = queue.then(() => apply(graph)).catch(() => undefined));

 const authoring = mountAuthoring({ container, area, editor, selector, selectable, render: options.render !== false, graphId, handlers, editable: () => editable, shown: () => shown, track, place });
 const { comments } = authoring;
 const behindNodes = () => Array.from(area.area.content.holder.children ?? []).find(element => !comments?.owns(element)) ?? null;
 const clearComments = () => { if (comments && comments.selected().length > 0) { comments.select([], false); handlers.onCommentSelect?.([]); } };

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
   if (nodeId === null) { for (const node of editor.getNodes()) selectable.unselect(node.id); clearComments(); return; }
   if (editor.getNode(nodeId)) selectable.select(nodeId, false);
  },
  setEditable(next) {
   if (next === editable) return;
   editable = next;
   for (const node of editor.getNodes() as GraphNode[]) { node.editable = next; void area.update('node', node.id); }
  },
  setDebugValues(next) {
   debugValues = next;
   for (const node of editor.getNodes() as GraphNode[]) {
    const value = next.get(node.id) ?? null;
    if (value?.text === node.debug?.text && value?.time === node.debug?.time) continue;
    node.debug = value;
    void area.update('node', node.id);
   }
  },
  zoomToFit: () => AreaExtensions.zoomAt(area, editor.getNodes()),
  destroy() { destroyed = true; authoring.destroy(); accumulating.destroy(); area.destroy(); },
  selectedComments: () => comments?.selected() ?? [],
  selectComments(ids) { comments?.select(ids, false); handlers.onCommentSelect?.(comments?.selected() ?? []); },
  boxes: authoring.boxes,
  sizes: () => new Map(authoring.boxes().map(box => [box.id, { width: box.width, height: box.height }] as const)),
 };
}

interface AuthoringContext {
 container: HTMLElement; area: AreaPlugin<Schemes, AreaExtra>; editor: NodeEditor<Schemes>;
 selector: ReturnType<typeof AreaExtensions.selector>; selectable: ReturnType<typeof AreaExtensions.selectableNodes>;
 render: boolean; graphId: string; handlers: ReteBlueprintHandlers;
 editable(): boolean; shown(): BlueprintGraph; track(change: (graph: BlueprintGraph) => BlueprintGraph): void; place(id: string, position: BlueprintNode['position']): Promise<void>;
}
// Box select and the comment layer. They send operations like any other user gesture: the change goes into `shown`, then to the handlers.
function mountAuthoring(context: AuthoringContext): { comments: CommentLayer | null; boxes(): Box[]; destroy(): void } {
 const { container, area, editor, selector, selectable, graphId, handlers } = context;
 const send = (ops: BlueprintOp[]) => {
  if (ops.length === 0) return;
  context.track(graph => { const result = applyBlueprintOps([graph], ops); return result.ok ? result.data[0]! : graph; });
  handlers.onOps(ops);
 };
 const boxes = (): Box[] => editor.getNodes().map(node => {
  const view = area.nodeViews.get(node.id), element = view?.element as HTMLElement | undefined;
  return { id: node.id, x: view?.position.x ?? 0, y: view?.position.y ?? 0, width: element?.offsetWidth || DEFAULT_NODE_SIZE.width, height: element?.offsetHeight || DEFAULT_NODE_SIZE.height };
 });
 const unselectNodes = () => { for (const node of editor.getNodes()) selectable.unselect(node.id); };
 // A Shift drag draws the selection rectangle, so the area pans only without Shift.
 area.area.setDragHandler(new Drag({ down: event => !(event.pointerType === 'mouse' && event.button !== 0) && !event.shiftKey, move: () => true }));
 let inside: string[] = [];
 const moveComment = (comment: BlueprintComment, to: { x: number; y: number }, phase: DragPhase) => {
  if (phase === 'start') { selector.release(); inside = nodesInComment(comment, boxes()); return; }
  const dx = to.x - comment.position.x, dy = to.y - comment.position.y;
  for (const nodeId of inside) {
   const node = context.shown().nodes.find(item => item.id === nodeId);
   if (node) void context.place(nodeId, { x: node.position.x + dx, y: node.position.y + dy });
  }
  if (phase === 'end') { send(commentMoveOps(context.shown(), comment.id, to, inside)); inside = []; }
 };
 const comments = context.render ? createCommentLayer(area.area.content.holder, () => area.area.transform.k, {
  select(ids, add) {
   if (!add) { unselectNodes(); handlers.onSelect(null); }
   comments!.select(ids, add);
   handlers.onCommentSelect?.(comments!.selected());
  },
  move(id, to, phase) { const comment = context.shown().comments?.find(item => item.id === id); if (comment) moveComment(comment, to, phase); },
  resize(id, size) { send([{ kind: 'updateComment', graphId, commentId: id, size }]); },
  menu(id, client) { handlers.onContextMenu?.({ kind: 'comment', commentId: id }, client); },
  open(id) { handlers.onCommentOpen?.(id); },
  focus() { container.focus({ preventScroll: true }); },
  editable: () => context.editable(),
 }) : null;
 const toCanvas = (client: { x: number; y: number }) => {
  const { x, y, k } = area.area.transform, box = container.getBoundingClientRect();
  return { x: (client.x - box.left - x) / k, y: (client.y - box.top - y) / k };
 };
 const selectBox = (rect: Rect, add: boolean) => {
  const previous = add ? { nodeIds: [...selector.entities.values()].filter(entity => entity.label === 'node').map(entity => entity.id), commentIds: comments?.selected() ?? [] } : null;
  const chosen = boxSelection(rect, boxes(), comments?.boxes() ?? [], previous);
  if (!add) unselectNodes();
  for (const id of chosen.nodeIds) void selectable.select(id, true);
  comments?.select(chosen.commentIds, false);
  handlers.onSelect(chosen.nodeIds.length === 1 && chosen.commentIds.length === 0 ? chosen.nodeIds[0]! : null);
  handlers.onCommentSelect?.(comments?.selected() ?? []);
 };
 const empty = (target: EventTarget | null) => target === container || target === area.area.content.holder;
 const detach = attachBoxSelect(container, empty, toCanvas, selectBox);
 return { comments, boxes, destroy() { detach(); comments?.destroy(); } };
}
