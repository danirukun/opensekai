import type { BlueprintNode } from '@opensekai/contracts';

// A node's footprint on the canvas, kept a little larger than a typical node so placed nodes do not touch.
const WIDTH = 200, HEIGHT = 110, RINGS = 6;

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
 Math.abs(a.x - b.x) < WIDTH && Math.abs(a.y - b.y) < HEIGHT;

// Grid cells around the origin, nearest first; at equal distance below comes before above and right before left.
const cells = Array.from({ length: (2 * RINGS + 1) ** 2 }, (_, k) => ({ i: k % (2 * RINGS + 1) - RINGS, j: Math.floor(k / (2 * RINGS + 1)) - RINGS }))
 .sort((a, b) => Math.hypot(a.i * WIDTH, a.j * HEIGHT) - Math.hypot(b.i * WIDTH, b.j * HEIGHT) || b.j - a.j || b.i - a.i);

// The free grid cell nearest to `origin`, so a new node stays in view and covers no other node.
export function freeSpot(nodes: readonly BlueprintNode[], origin: { x: number; y: number }): { x: number; y: number } {
 for (const { i, j } of cells) {
  const spot = { x: Math.round(origin.x + i * WIDTH), y: Math.round(origin.y + j * HEIGHT) };
  if (!nodes.some(node => overlaps(node.position, spot))) return spot;
 }
 return origin;
}
