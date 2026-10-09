import type { BlueprintNode } from '@opensekai/contracts';

// A node's footprint on the canvas, kept a little larger than a typical node so placed nodes do not touch.
const WIDTH = 200, HEIGHT = 110, COLUMNS = 4;

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
 Math.abs(a.x - b.x) < WIDTH && Math.abs(a.y - b.y) < HEIGHT;

// The first grid cell from `origin`, row by row, that no existing node covers.
export function freeSpot(nodes: readonly BlueprintNode[], origin: { x: number; y: number }): { x: number; y: number } {
 for (let i = 0; i < 256; i++) {
  const spot = { x: Math.round(origin.x + (i % COLUMNS) * WIDTH), y: Math.round(origin.y + Math.floor(i / COLUMNS) * HEIGHT) };
  if (!nodes.some(node => overlaps(node.position, spot))) return spot;
 }
 return origin;
}
