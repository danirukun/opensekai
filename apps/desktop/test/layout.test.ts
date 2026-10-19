import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintConnection, type BlueprintNode } from '@opensekai/contracts';
import { DEFAULT_NODE_SIZE, formatLayout, formatOps } from '../src/blueprints/layout';

const flash = () => BlueprintSetSchema.parse(fixture.blueprints)[1]!;
const at = (x: number, y: number) => ({ x, y });
const manual = (id: string, x = 0, y = 0): BlueprintNode => ({ id, version: 1, type: 'event.manual', settings: {}, position: at(x, y) } as BlueprintNode);
const delay = (id: string, x = 0, y = 0): BlueprintNode => ({ id, version: 1, type: 'flow.delay', settings: { seconds: 1 }, position: at(x, y) } as BlueprintNode);
const flow = (id: string, from: string, to: string, port = 'exit'): BlueprintConnection => ({ id, sourceNodeId: from, sourcePort: port, targetNodeId: to, targetPort: 'flow' });
const column = (positions: Map<string, { x: number }>, id: string) => positions.get(id)!.x;

it('places flow nodes in layers from left to right by longest path, from the top-left corner of the set', () => {
 const nodes = [manual('a', 500, 300), delay('b', 100, 900), delay('c', 40, 400), delay('d', 700, 200)];
 const wires = [flow('1', 'a', 'b', 'flow'), flow('2', 'b', 'c'), flow('3', 'a', 'c', 'flow'), flow('4', 'c', 'd')];
 const out = formatLayout(nodes, wires);
 const step = DEFAULT_NODE_SIZE.width + 80;
 expect(['a', 'b', 'c', 'd'].map(id => column(out, id))).toEqual([40, 40 + step, 40 + 2 * step, 40 + 3 * step]);
 expect(Math.min(...[...out.values()].map(point => point.y))).toBe(200);
});

it('puts a data-only node one layer left of its consumer and never overlaps nodes in a layer', () => {
 const g = flash();
 const out = formatLayout(g.nodes, g.connections);
 // key -> show -> wait -> hide on flow; `on` feeds show and `off` feeds hide.
 expect(column(out, 'show')).toBeGreaterThan(column(out, 'key'));
 expect(column(out, 'on')).toBe(column(out, 'key'));
 expect(column(out, 'off')).toBe(column(out, 'wait'));
 // The flow chain lines up on one row, and each data feeder sits below the flow node in its layer.
 expect(new Set(['key', 'show', 'wait', 'hide'].map(id => out.get(id)!.y)).size).toBe(1);
 expect(out.get('on')!.y).toBeGreaterThan(out.get('key')!.y);
 const layers = new Map<number, number[]>();
 for (const point of out.values()) layers.set(point.x, [...(layers.get(point.x) ?? []), point.y].sort((a, b) => a - b));
 for (const ys of layers.values()) ys.slice(1).forEach((y, i) => expect(y - ys[i]!).toBeGreaterThanOrEqual(DEFAULT_NODE_SIZE.height + 40));
});

it('ignores a back edge of a flow cycle and stacks unconnected groups in their vertical order', () => {
 const nodes = [delay('x', 0, 0), delay('y', 0, 0), manual('lonely', 0, -500), manual('late', 0, 500)];
 const out = formatLayout(nodes, [flow('1', 'x', 'y'), flow('2', 'y', 'x')]);
 expect(column(out, 'y') - column(out, 'x')).toBe(DEFAULT_NODE_SIZE.width + 80);
 expect(out.get('lonely')!.y).toBe(-500);
 expect(out.get('x')!.y).toBe(-500 + DEFAULT_NODE_SIZE.height + 80);
 expect(out.get('late')!.y).toBeGreaterThan(out.get('x')!.y);
});

it('uses measured sizes, keeps a single node in place, and lays out only the given nodes', () => {
 const sizes = new Map([['a', { width: 400, height: 300 }]]);
 const out = formatLayout([manual('a'), delay('b', 10, 10)], [flow('1', 'a', 'b', 'flow')], sizes);
 expect(out.get('b')!.x).toBe(400 + 80);
 expect(formatLayout([delay('only', 7, 9)], [])).toEqual(new Map([['only', at(7, 9)]]));
 const g = flash();
 const part = formatLayout(g.nodes.filter(node => ['show', 'wait'].includes(node.id)), g.connections);
 expect([...part.keys()].sort()).toEqual(['show', 'wait']);
 expect(formatLayout([], [])).toEqual(new Map());
});

it('sends one moveNode per moved node, which applies as one batch and is stable on a second format', () => {
 const g = flash();
 const ops = formatOps(g.id, g.nodes, formatLayout(g.nodes, g.connections));
 expect(ops.every(op => op.kind === 'moveNode')).toBe(true);
 const r = applyBlueprintOps([g], ops);
 if (!r.ok) throw new Error(r.error.message);
 const again = r.data[0]!;
 expect(formatOps(again.id, again.nodes, formatLayout(again.nodes, again.connections))).toEqual([]);
});
