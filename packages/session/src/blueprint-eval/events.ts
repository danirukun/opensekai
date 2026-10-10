import type { EvaluatorTable } from './types';

// Event nodes only start runs; the runner follows their output directly.
export const EVENT_EVALUATORS = {
 'event.manual': {},
 'event.keystroke': {},
 'event.enable': {},
} satisfies Partial<EvaluatorTable>;
