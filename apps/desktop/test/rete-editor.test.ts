import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintOp } from '@opensekai/contracts';
import { mountReteBlueprint } from '../src/blueprints/rete-editor';

// A minimal DOM: enough for the Rete area plugin, which the adapter drives without the Svelte renderer here.
// Children are tracked, because the adapter reorders each new wire view inside the area content.
const element = (): Record<string, unknown> => {
 const children: unknown[] = [];
 const detach = (child: unknown) => { const at = children.indexOf(child); if (at >= 0) children.splice(at, 1); };
 const node: Record<string, unknown> = {
  style: {}, classList: { add() {}, remove() {} }, children,
  addEventListener() {}, removeEventListener() {}, setAttribute() {},
  appendChild: (child: unknown) => { detach(child); children.push(child); return child; },
  insertBefore: (child: unknown, next: unknown) => { detach(child); const at = children.indexOf(next); children.splice(at < 0 ? children.length : at, 0, child); return child; },
  removeChild: (child: unknown) => { detach(child); return child; },
  contains: (child: unknown) => child === node || children.includes(child),
  get firstChild() { return children[0] ?? null; },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  clientWidth: 800, clientHeight: 600,
 };
 node.ownerDocument = { createElement: element };
 return node;
};
beforeEach(() => { vi.stubGlobal('document', { createElement: element, addEventListener() {}, removeEventListener() {} }); vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} }); });
afterEach(() => { vi.unstubAllGlobals(); });

const [, graph] = BlueprintSetSchema.parse(fixture.blueprints);

it('emits no operations while it patches the canvas, and one moveNode for a user translate', async () => {
 const ops: BlueprintOp[][] = [];
 let area!: { translate(id: string, position: { x: number; y: number }): Promise<unknown> };
 const editor = await mountReteBlueprint(element() as unknown as HTMLElement, graph!, { onSelect() {}, onOps: next => { ops.push(next); } }, { render: false, inspect: value => { area = value as never; } });
 expect(ops).toEqual([]);
 const added = applyBlueprintOps([graph!], [{ kind: 'addNode', graphId: graph!.id, node: { id: 'extra', version: 1, type: 'value.number', settings: { value: 1 }, position: { x: 40, y: 50 } } }]);
 if (!added.ok) throw new Error();
 await editor.show(added.data[0]!);
 expect(ops).toEqual([]);
 await area.translate('wait', { x: 11, y: 12 });
 expect(ops).toEqual([[{ kind: 'moveNode', graphId: graph!.id, nodeId: 'wait', position: { x: 11, y: 12 } }]]);
});

it('reports one context menu for a node right-click that bubbles to the canvas', async () => {
 const menus: unknown[] = [];
 let area!: { emit(context: unknown): Promise<unknown> };
 await mountReteBlueprint(element() as unknown as HTMLElement, graph!, { onSelect() {}, onOps() {}, onContextMenu: target => { menus.push(target); } }, { render: false, inspect: value => { area = value as never; } });
 const event = { preventDefault() {}, clientX: 5, clientY: 6 };
 await area.emit({ type: 'contextmenu', data: { event, context: { id: 'wait', label: 'Delay' } } });
 await area.emit({ type: 'contextmenu', data: { event, context: 'root' } });
 await area.emit({ type: 'contextmenu', data: { event: { ...event }, context: 'root' } });
 await area.emit({ type: 'contextmenu', data: { event: { ...event }, context: { id: 'w1', source: 'key', target: 'show' } } });
 expect(menus).toEqual([{ kind: 'node', nodeId: 'wait' }, { kind: 'canvas' }, { kind: 'wire', connectionId: 'w1' }]);
});

it('keeps the selection through a right-button press and release', async () => {
 let area!: { emit(context: unknown): Promise<unknown> };
 const editor = await mountReteBlueprint(element() as unknown as HTMLElement, graph!, { onSelect() {}, onOps() {} }, { render: false, inspect: value => { area = value as never; } });
 editor.selectMany(['show', 'wait']);
 const data = { position: { x: 0, y: 0 }, event: { button: 2 } };
 await area.emit({ type: 'pointerdown', data });
 await area.emit({ type: 'pointerup', data });
 expect(editor.selected().sort()).toEqual(['show', 'wait']);
 await area.emit({ type: 'pointerdown', data: { ...data, event: { button: 0 } } });
 await area.emit({ type: 'pointerup', data: { ...data, event: { button: 0 } } });
 expect(editor.selected()).toEqual([]);
});

it('retypes a port and removes its wire when a property changes type', async () => {
 const g = { schemaVersion: 1, id: 'p', name: 'P', enabled: true, variables: [], nodes: [
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: { x: 0, y: 0 } },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'reference', property: 'position' }, position: { x: 200, y: 0 } },
 ], connections: [{ id: 'w', sourceNodeId: 'make', sourcePort: 'value', targetNodeId: 'set', targetPort: 'value' }] } as const;
 let area!: { parentScope(): { getConnections(): unknown[]; getNode(id: string): { inputs: Record<string, { socket: { name: string } }> } } };
 const editor = await mountReteBlueprint(element() as unknown as HTMLElement, g as never, { onSelect() {}, onOps() {} }, { render: false, inspect: value => { area = value as never; } });
 expect(area.parentScope().getConnections()).toHaveLength(1);
 const next = applyBlueprintOps([g as never], [{ kind: 'setNodeSettings', graphId: 'p', nodeId: 'set', settings: { entityId: 'reference', property: 'visible' } }]);
 if (!next.ok) throw new Error(next.error.message);
 await editor.show(next.data[0]!);
 expect(area.parentScope().getConnections()).toEqual([]);
 expect(area.parentScope().getNode('set').inputs.value!.socket.name).toBe('Boolean');
});

it('puts each wire view behind every node view', async () => {
 let area!: { area: { content: { holder: { children: unknown[] } } }; nodeViews: Map<string, { element: unknown }>; connectionViews: Map<string, { element: unknown }> };
 await mountReteBlueprint(element() as unknown as HTMLElement, graph!, { onSelect() {}, onOps() {} }, { render: false, inspect: value => { area = value as never; } });
 const order = area.area.content.holder.children;
 const wires = [...area.connectionViews.values()].map(view => order.indexOf(view.element));
 const nodes = [...area.nodeViews.values()].map(view => order.indexOf(view.element));
 expect(wires.length).toBeGreaterThan(0);
 expect(Math.max(...wires)).toBeLessThan(Math.min(...nodes));
});

it('tracks wired inputs and sends one setNodeInput for an inline edit', async () => {
 const ops: BlueprintOp[][] = [];
 let area!: { parentScope<T>(type: unknown): T };
 const editor = await mountReteBlueprint(element() as unknown as HTMLElement, graph!, { onSelect() {}, onOps: next => { ops.push(next); } }, { render: false, inspect: value => { area = value as never; } });
 const { NodeEditor } = await import('rete');
 const show = () => area.parentScope<{ getNode(id: string): { wired: Map<string, number>; data: { inputs?: object }; setInput(port: string, value: unknown): void } }>(NodeEditor).getNode('show');
 expect([...show().wired.entries()].sort()).toEqual([['flow', 1], ['visible', 1]]);
 const cut = applyBlueprintOps([graph!], [{ kind: 'disconnect', graphId: graph!.id, connectionId: 'w2' }]);
 if (!cut.ok) throw new Error();
 await editor.show(cut.data[0]!);
 expect([...show().wired.keys()]).toEqual(['flow']);
 editor.setEditable(false);
 show().setInput('visible', true);
 expect(ops).toEqual([]);
 editor.setEditable(true);
 show().setInput('visible', true);
 expect(ops).toEqual([[{ kind: 'setNodeInput', graphId: graph!.id, nodeId: 'show', port: 'visible', value: true }]]);
 expect(show().data.inputs).toEqual({ visible: true });
 const echo = applyBlueprintOps(cut.data, [{ kind: 'setNodeInput', graphId: graph!.id, nodeId: 'show', port: 'visible', value: true }]);
 if (!echo.ok) throw new Error();
 await editor.show(echo.data[0]!);
 expect(ops).toHaveLength(1);
});
