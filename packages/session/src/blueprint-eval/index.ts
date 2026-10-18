import { CHARACTER_EVALUATORS } from './character';
import { EVENT_EVALUATORS } from './events';
import { FLOW_EVALUATORS } from './flow';
import { INPUT_EVALUATORS } from './input';
import { PROPERTY_EVALUATORS } from './properties';
import { SCENE_EVALUATORS } from './scene';
import type { EvaluatorTable } from './types';
import { VALUE_EVALUATORS } from './values';
import { VARIABLE_EVALUATORS } from './variables';
import { VECTOR3_EVALUATORS } from './vector3';
import { DEVICE_EVALUATORS } from './devices';
import { TIMER_EVALUATORS } from './timer';
import { GRAPH_CONTROL_EVALUATORS } from './graph-control';

export * from './types';
export * from './devices';
export * from './requests';
// The annotation makes a missing node type a compile error.
export const EVALUATORS: EvaluatorTable = { ...EVENT_EVALUATORS, ...INPUT_EVALUATORS, ...FLOW_EVALUATORS, ...VALUE_EVALUATORS, ...VECTOR3_EVALUATORS, ...VARIABLE_EVALUATORS, ...SCENE_EVALUATORS, ...PROPERTY_EVALUATORS, ...CHARACTER_EVALUATORS, ...DEVICE_EVALUATORS, ...TIMER_EVALUATORS, ...GRAPH_CONTROL_EVALUATORS };
