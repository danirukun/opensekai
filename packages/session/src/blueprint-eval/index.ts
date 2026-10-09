import { EVENT_EVALUATORS } from './events';
import { FLOW_EVALUATORS } from './flow';
import { SCENE_EVALUATORS } from './scene';
import type { EvaluatorTable } from './types';
import { VALUE_EVALUATORS } from './values';

export * from './types';
// The annotation makes a missing node type a compile error.
export const EVALUATORS: EvaluatorTable = { ...EVENT_EVALUATORS, ...FLOW_EVALUATORS, ...VALUE_EVALUATORS, ...SCENE_EVALUATORS };
