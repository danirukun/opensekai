import { EVENT_EVALUATORS } from './events';
import { FLOW_EVALUATORS } from './flow';
import { INPUT_EVALUATORS } from './input';
import { SCENE_EVALUATORS } from './scene';
import type { EvaluatorTable } from './types';
import { VALUE_EVALUATORS } from './values';
import { VARIABLE_EVALUATORS } from './variables';
import { VECTOR3_EVALUATORS } from './vector3';

export * from './types';
// The annotation makes a missing node type a compile error.
export const EVALUATORS: EvaluatorTable = { ...EVENT_EVALUATORS, ...INPUT_EVALUATORS, ...FLOW_EVALUATORS, ...VALUE_EVALUATORS, ...VECTOR3_EVALUATORS, ...VARIABLE_EVALUATORS, ...SCENE_EVALUATORS };
