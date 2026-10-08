import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema } from '@opensekai/contracts';
import { graphPatch } from '../src/blueprints/graph-patch';

it('computes the minimal canvas patch between two graph versions', () => {
 const [before] = BlueprintSetSchema.parse(fixture.blueprints).slice(1);
 const after = applyBlueprintOps([before!], [
  { kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 1, y: 2 } },
  { kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: 3 } },
  { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'off' },
 ]);
 if (!after.ok) throw new Error();
 expect(graphPatch(before, after.data[0])).toEqual({
  removeConnections: ['w5'], removeNodes: ['off'], addNodes: [],
  updateNodes: [expect.objectContaining({ id: 'wait', settings: { seconds: 3 } })],
  moveNodes: [{ id: 'wait', position: { x: 1, y: 2 } }], addConnections: [],
 });
});
