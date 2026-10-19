type Point = { x: number; y: number };
export interface Rect { x: number; y: number; width: number; height: number }
export interface Box extends Rect { id: string }
export interface BoxSelection { nodeIds: string[]; commentIds: string[] }

export const rectFrom = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
export const intersects = (a: Rect, b: Rect) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
export const contains = (outer: Rect, inner: Rect) =>
 inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

// Nodes that touch the rectangle and comments fully inside it; `add` keeps the previous selection too.
export function boxSelection(rect: Rect, nodes: readonly Box[], comments: readonly Box[], previous: BoxSelection | null = null): BoxSelection {
 const nodeIds = nodes.filter(box => intersects(rect, box)).map(box => box.id);
 const commentIds = comments.filter(box => contains(rect, box)).map(box => box.id);
 if (!previous) return { nodeIds, commentIds };
 return { nodeIds: [...new Set([...previous.nodeIds, ...nodeIds])], commentIds: [...new Set([...previous.commentIds, ...commentIds])] };
}
