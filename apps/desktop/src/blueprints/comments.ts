import { MAX_COMMENT_SIZE, MIN_COMMENT_SIZE, type BlueprintComment, type BlueprintGraph, type BlueprintOp } from '@opensekai/contracts';
import { contains, type Box, type Rect } from './box-select';

type Point = { x: number; y: number };
export const COMMENT_PADDING = 32, COMMENT_HEADER = 28;
export const NEW_COMMENT_SIZE = { width: 320, height: 200 };
const extent = (value: number) => Math.round(Math.min(MAX_COMMENT_SIZE, Math.max(MIN_COMMENT_SIZE, value)));

export const commentRect = (comment: BlueprintComment): Rect => ({ x: comment.position.x, y: comment.position.y, width: comment.size.width, height: comment.size.height });
// The nodes that a comment drag moves: each node fully inside the comment.
export const nodesInComment = (comment: BlueprintComment, nodes: readonly Box[]): string[] =>
 nodes.filter(box => contains(commentRect(comment), box)).map(box => box.id);

// A comment that wraps the boxes with a margin and a header, or a new comment of the default size at `at`.
export function wrapComment(id: string, boxes: readonly Box[], at: Point): BlueprintComment {
 if (boxes.length === 0) return { id, text: '', position: { x: Math.round(at.x), y: Math.round(at.y) }, size: { ...NEW_COMMENT_SIZE } };
 const left = Math.min(...boxes.map(box => box.x)) - COMMENT_PADDING, top = Math.min(...boxes.map(box => box.y)) - COMMENT_PADDING - COMMENT_HEADER;
 const right = Math.max(...boxes.map(box => box.x + box.width)) + COMMENT_PADDING, bottom = Math.max(...boxes.map(box => box.y + box.height)) + COMMENT_PADDING;
 return { id, text: '', position: { x: Math.round(left), y: Math.round(top) }, size: { width: extent(right - left), height: extent(bottom - top) } };
}

// One batch for a comment drag: the comment position and each node inside it, moved by the same amount.
export function commentMoveOps(graph: BlueprintGraph, commentId: string, to: Point, nodeIds: readonly string[]): BlueprintOp[] {
 const comment = graph.comments?.find(item => item.id === commentId);
 if (!comment) return [];
 const dx = Math.round(to.x) - comment.position.x, dy = Math.round(to.y) - comment.position.y;
 if (dx === 0 && dy === 0) return [];
 return [
  { kind: 'updateComment', graphId: graph.id, commentId, position: { x: comment.position.x + dx, y: comment.position.y + dy } },
  ...graph.nodes.filter(node => nodeIds.includes(node.id)).map(node => ({ kind: 'moveNode' as const, graphId: graph.id, nodeId: node.id, position: { x: node.position.x + dx, y: node.position.y + dy } })),
 ];
}
export const commentSize = (size: { width: number; height: number }) => ({ width: extent(size.width), height: extent(size.height) });
