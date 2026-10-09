import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema } from '@opensekai/contracts';
import { copyNodes, duplicateAnchor, pasteOps } from '../src/blueprints/clipboard';

const graphs = BlueprintSetSchema.parse(fixture.blueprints);
const flash = graphs[1]!;
const ids = () => { let n = 0; return () => `new${n++}`; };

it('copies the selected nodes and only the wires between them', () => {
 const clip = copyNodes(flash, ['show', 'wait', 'on']);
 expect(clip?.nodes.map(node => node.id)).toEqual(['on', 'show', 'wait']);
 expect(clip?.connections.map(wire => wire.id)).toEqual(['w2', 'w3']);
 expect(copyNodes(flash, [])).toBeNull();
});

it('pastes with new IDs and the same layout at the anchor, into another graph', () => {
 const clip = copyNodes(flash, ['show', 'wait'])!;
 const { ops, nodeIds } = pasteOps(clip, 'toggle-performer', { x: 1000, y: 500 }, ids());
 expect(nodeIds).toEqual(['new0', 'new1']);
 const pasted = applyBlueprintOps(graphs, ops);
 if (!pasted.ok) throw new Error(pasted.error.message);
 const target = pasted.data[0]!;
 expect(target.nodes.filter(node => nodeIds.includes(node.id)).map(node => node.position)).toEqual([{ x: 1000, y: 500 }, { x: 1300, y: 500 }]);
 expect(target.connections.at(-1)).toEqual({ id: 'new2', sourceNodeId: 'new0', sourcePort: 'exit', targetNodeId: 'new1', targetPort: 'flow' });
 expect(duplicateAnchor(clip)).toEqual({ x: 324, y: 24 });
});
