import { CHARACTER_EVALUATORS } from './character';
import { EVENT_EVALUATORS } from './events';
import { FLOW_EVALUATORS } from './flow';
import { INPUT_EVALUATORS } from './input';
import { INTEGER_EVALUATORS } from './integer';
import { MATH_EVALUATORS } from './math';
import { PROPERTY_EVALUATORS } from './properties';
import { SCENE_EVALUATORS } from './scene';
import type { EvaluatorTable } from './types';
import { VALUE_EVALUATORS } from './values';
import { VARIABLE_EVALUATORS } from './variables';
import { VECTOR3_EVALUATORS } from './vector3';
import { DEVICE_EVALUATORS } from './devices';
import { DEBUG_EVALUATORS } from './debug';
import { LITERAL_EVALUATORS } from './literals';
import { TEXT_EVALUATORS } from './text';
import { LIST_EVALUATORS } from './lists';
import { SWITCH_EVALUATORS } from './switches';
import { TYPED_VARIABLE_EVALUATORS } from './typed-variables';
import { TIMER_EVALUATORS } from './timer';
import { GRAPH_CONTROL_EVALUATORS } from './graph-control';
import { TRACKING_EVALUATORS } from './tracking';

export * from './types';
export * from './devices';
export * from './requests';
export { isTrackingTrigger, trackingTrigger, type TrackingEdge } from './tracking';
// The annotation makes a missing node type a compile error.
export const EVALUATORS: EvaluatorTable = { ...EVENT_EVALUATORS, ...INPUT_EVALUATORS, ...FLOW_EVALUATORS, ...VALUE_EVALUATORS, ...VECTOR3_EVALUATORS, ...VARIABLE_EVALUATORS, ...SCENE_EVALUATORS, ...PROPERTY_EVALUATORS, ...CHARACTER_EVALUATORS, ...TRACKING_EVALUATORS, ...DEVICE_EVALUATORS, ...MATH_EVALUATORS, ...INTEGER_EVALUATORS, ...LITERAL_EVALUATORS, ...TEXT_EVALUATORS, ...LIST_EVALUATORS, ...SWITCH_EVALUATORS, ...TYPED_VARIABLE_EVALUATORS, ...TIMER_EVALUATORS, ...GRAPH_CONTROL_EVALUATORS, ...DEBUG_EVALUATORS };
