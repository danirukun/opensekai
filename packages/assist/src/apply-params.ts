import { fingerprint, type Expectation, type Id, type ProposalApplyParams } from '@opensekai/contracts';
import type { CompileContext, Proposal } from './compile-kit';

// Touched IDs expect their value in the context the proposal was compiled against; created IDs must not exist yet (R15).
const expectations = (current: readonly { id: Id }[], touched: Id[], created: Id[]): Expectation[] => [
 ...touched.map(id => ({ id, fingerprint: fingerprint(current.find(x => x.id === id)) })),
 ...created.map(id => ({ id, fingerprint: null })),
];

export const toApplyParams = (proposal: Proposal, context: CompileContext, batch: { clientId: Id; batchId: Id }, outputId?: Id): ProposalApplyParams => ({
 sceneId: context.scene.sceneId,
 expect: {
  entities: expectations(context.scene.entities, proposal.touched.entities, proposal.created.entities),
  blueprints: expectations(context.blueprints, proposal.touched.blueprints, proposal.created.blueprints),
 },
 sceneOps: proposal.sceneOps,
 blueprint: proposal.blueprintOps.length > 0 ? { ...batch, ops: proposal.blueprintOps } : null,
 output: proposal.output && { outputId: outputId ?? proposal.output.outputId, cameraId: proposal.output.cameraId },
});
