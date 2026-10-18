import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintComment, type BlueprintGraph, type BlueprintOp } from '@opensekai/contracts';
import { boxSelection, contains, intersects, rectFrom } from '../src/blueprints/box-select';
import { commentMoveOps, commentSize, nodesInComment, wrapComment } from '../src/blueprints/comments';
import { copyNodes, pasteOps } from '../src/blueprints/clipboard';
import { deleteOps } from '../src/blueprints/selection-ops';
import { createUndoHistory, diffOps } from '../src/blueprints/undo';

const flash = () => BlueprintSetSchema.parse(fixture.blueprints)[1]!;
const apply = (graph: BlueprintGraph, ops: BlueprintOp[]) => { const r = applyBlueprintOps([graph], ops); if (!r.ok) throw new Error(r.error.message); return r.data[0]!; };
const box = (id: string, x: number, y: number, width = 100, height = 50) => ({ id, x, y, width, height });
const note = (extra: Partial<BlueprintComment> = {}): BlueprintComment => ({ id: 'c1', text: 'Flash', position: { x: -40, y: -60 }, size: { width: 400, height: 300 }, ...extra });
const withNote = () => apply(flash(), [{ kind: 'addComment', graphId: 'flash-marker', comment: note() }]);

it('selects nodes that touch the rectangle and comments fully inside it, from any drag direction', () => {
 expect(rectFrom({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 60 });
 const rect = rectFrom({ x: 300, y: 200 }, { x: 0, y: 0 });
 const nodes = [box('in', 10, 10), box('edge', 250, 180), box('out', 301, 0), box('touching', 300, 10)];
 const comments = [box('c-in', 5, 5, 200, 100), box('c-part', 100, 100, 300, 100)];
 expect(boxSelection(rect, nodes, comments)).toEqual({ nodeIds: ['in', 'edge'], commentIds: ['c-in'] });
 expect(boxSelection(rect, nodes, comments, { nodeIds: ['out', 'in'], commentIds: ['c-part'] })).toEqual({ nodeIds: ['out', 'in', 'edge'], commentIds: ['c-part', 'c-in'] });
 expect(intersects(rect, box('zero', 300, 200))).toBe(false);
 expect(contains(rect, box('same', 0, 0, 300, 200))).toBe(true);
});

it('moves the nodes fully inside a comment with it, as one batch', () => {
 const g = withNote();
 // The 400 x 300 comment at (-40,-60) holds `key` only; `on` and `show` stick out of it.
 const boxes = g.nodes.map(node => box(node.id, node.position.x, node.position.y));
 expect(nodesInComment(g.comments![0]!, boxes)).toEqual(['key']);
 expect(nodesInComment(note({ size: { width: 500, height: 400 } }), boxes)).toEqual(['key', 'on', 'off', 'show']);
 const ops = commentMoveOps(g, 'c1', { x: 60, y: -10 }, ['key', 'on', 'show']);
 expect(ops[0]).toEqual({ kind: 'updateComment', graphId: 'flash-marker', commentId: 'c1', position: { x: 60, y: -10 } });
 const moved = apply(g, ops);
 expect(moved.nodes.filter(node => ['key', 'on', 'show'].includes(node.id)).map(node => node.position)).toEqual([{ x: 100, y: 50 }, { x: 100, y: 250 }, { x: 400, y: 50 }]);
 expect(moved.nodes.find(node => node.id === 'wait')!.position).toEqual({ x: 600, y: 0 });
 expect(commentMoveOps(g, 'c1', { x: -40, y: -60 }, ['key'])).toEqual([]);
 expect(commentMoveOps(g, 'missing', { x: 0, y: 0 }, [])).toEqual([]);
});

it('wraps selected nodes with a margin and header, or adds the default comment at the pointer', () => {
 expect(wrapComment('n', [box('a', 0, 0), box('b', 300, 200, 180, 100)], { x: 0, y: 0 })).toEqual({ id: 'n', text: '', position: { x: -32, y: -60 }, size: { width: 544, height: 392 } });
 expect(wrapComment('n', [], { x: 10.4, y: 20.6 })).toEqual({ id: 'n', text: '', position: { x: 10, y: 21 }, size: { width: 320, height: 200 } });
 expect(commentSize({ width: 10, height: 90000 })).toEqual({ width: 64, height: 8192 });
});

it('copies, pastes, and deletes selected comments with nodes', () => {
 const g = withNote();
 const clip = copyNodes(g, ['show'], ['c1'])!;
 expect(clip.comments).toEqual([note()]);
 expect(copyNodes(g, [], ['c1'])?.nodes).toEqual([]);
 expect(copyNodes(g, [], ['nope'])).toBeNull();
 let n = 0;
 const { ops, commentIds } = pasteOps(clip, 'flash-marker', { x: 1000, y: 1000 }, () => `p${n++}`);
 expect(commentIds).toEqual(['p1']);
 const pasted = apply(g, ops);
 // The comment is the top-left corner of the clip, so it lands on the anchor and the node keeps its offset.
 expect(pasted.comments!.find(comment => comment.id === 'p1')!.position).toEqual({ x: 1000, y: 1000 });
 expect(pasted.nodes.find(node => node.id === 'p0')!.position).toEqual({ x: 1340, y: 1060 });
 expect(deleteOps(g, ['show'], ['c1', 'gone'])).toEqual([
  { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }, { kind: 'removeComment', graphId: 'flash-marker', commentId: 'c1' }]);
});

it('undoes and redoes comment changes, and a comment drag with its nodes is one step', () => {
 const before = flash(), added = withNote();
 expect(apply(added, diffOps(added, before)).comments).toEqual([]);
 expect(apply(before, diffOps(before, added)).comments).toEqual([note()]);
 const edited = apply(added, [{ kind: 'updateComment', graphId: 'flash-marker', commentId: 'c1', text: 'Done', size: { width: 500, height: 300 } }]);
 expect(apply(edited, diffOps(edited, added)).comments).toEqual([note()]);
 const history = createUndoHistory(() => 0);
 const drag = commentMoveOps(added, 'c1', { x: 0, y: 0 }, ['key', 'on']);
 const dragged = apply(added, drag);
 history.record('flash-marker', added, dragged, drag);
 let current = dragged;
 expect(history.undo('flash-marker', ops => { current = apply(current, ops); return true; })).toBe(true);
 expect(current.comments).toEqual(added.comments);
 expect(current.nodes.map(node => node.position)).toEqual(added.nodes.map(node => node.position));
 expect(history.canUndo('flash-marker')).toBe(false);
});
