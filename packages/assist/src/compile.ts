import { PROPOSAL_LIMITS, type Reply } from '@opensekai/contracts';
import { z } from 'zod';
import { IntentSchema, type Intent, type IntentTool } from './intents';
import { BLUEPRINT_OPS, emptyProposal, invalid, ok, type CompileContext, type Compiler, type Proposal, type WorkingState } from './compile-kit';
import { compileCamera, compileEnvironment, compileHaze, compileLight, compileOutput, compileProps } from './compile-scene';
import { compileCameraMove } from './camera-move';
import { compileBlueprintBuild } from './blueprint-build';

export { applyToWorking, emptyProposal, type CompileContext, type Compiler, type Note, type Proposal, type WorkingState } from './compile-kit';

const unavailable = (message: string): Compiler => () => invalid(message);
const COMPILERS: Record<IntentTool, Compiler> = {
 light_setup: compileLight, camera_add: compileCamera, environment_set: compileEnvironment, prop_place: compileProps,
 haze_set: compileHaze, output_camera: compileOutput,
 camera_move: compileCameraMove, blueprint_build: compileBlueprintBuild,
 ask: unavailable('ask is not a scene change'), look_up: unavailable('look_up is not a scene change'),
};

export const compileIntents = (intents: Intent[], context: CompileContext): Reply<Proposal> => {
 const parsed = z.array(IntentSchema).safeParse(intents);
 if (!parsed.success) return invalid(`Invalid intent: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
 const start: WorkingState = { scene: context.scene, blueprints: context.blueprints, proposal: emptyProposal(context.refs) };
 const done = parsed.data.reduce<Reply<WorkingState>>((r, intent) => r.ok ? COMPILERS[intent.tool](intent, r.data, context) : r, ok(start));
 if (!done.ok) return done;
 const p = done.data.proposal;
 if (p.sceneOps.length > PROPOSAL_LIMITS.sceneOps) return invalid(`A proposal has at most ${PROPOSAL_LIMITS.sceneOps} scene operations`);
 if (p.blueprintOps.length > BLUEPRINT_OPS) return invalid(`A proposal has at most ${BLUEPRINT_OPS} Blueprint operations`);
 if (p.sceneOps.length === 0 && p.blueprintOps.length === 0 && p.output === null) return invalid('Nothing to change');
 return ok(p);
};
