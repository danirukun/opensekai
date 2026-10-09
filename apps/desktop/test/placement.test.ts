import { expect, it } from 'vitest';
import type { BlueprintNode } from '@opensekai/contracts';
import { freeSpot } from '../src/blueprints/placement';

const at = (x: number, y: number): BlueprintNode => ({ id: `${x},${y}`, version: 1, type: 'event.manual', settings: {}, position: { x, y } });

it('uses the origin when no node covers it', () => {
 expect(freeSpot([], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
 expect(freeSpot([at(500, 500)], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
});

it('moves right, then down, past nodes that cover the origin', () => {
 expect(freeSpot([at(0, 0)], { x: 0, y: 0 })).toEqual({ x: 200, y: 0 });
 expect(freeSpot([at(0, 0), at(200, 0), at(400, 0), at(600, 0)], { x: 0, y: 0 })).toEqual({ x: 0, y: 110 });
 expect(freeSpot([at(30, 40)], { x: 0, y: 0 })).toEqual({ x: 400, y: 0 });
});
