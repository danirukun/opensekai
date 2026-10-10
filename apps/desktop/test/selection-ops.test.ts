import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { BlueprintSetSchema } from '@opensekai/contracts';
import { deleteOps, disconnectOps } from '../src/blueprints/selection-ops';

const graph = BlueprintSetSchema.parse(fixture.blueprints)[1]!;

it('deletes each selected node once and ignores unknown IDs', () => {
 expect(deleteOps(graph, ['show', 'wait', 'show', 'gone'])).toEqual([
  { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }, { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'wait' }]);
});

it('disconnects every wire that touches the selection', () => {
 expect(disconnectOps(graph, ['show']).map(op => op.kind === 'disconnect' && op.connectionId)).toEqual(['w1', 'w2', 'w3']);
});
