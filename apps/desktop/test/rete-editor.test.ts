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
