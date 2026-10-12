import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintOp } from '@opensekai/contracts';
import { mountReteBlueprint } from '../src/blueprints/rete-editor';

// A minimal DOM: enough for the Rete area plugin, which the adapter drives without the Svelte renderer here.
const element = (): Record<string, unknown> => {
 const node: Record<string, unknown> = {
  style: {}, classList: { add() {}, remove() {} }, children: [],
  addEventListener() {}, removeEventListener() {}, setAttribute() {},
  appendChild: (child: unknown) => child, removeChild: (child: unknown) => child, contains: () => false,
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
