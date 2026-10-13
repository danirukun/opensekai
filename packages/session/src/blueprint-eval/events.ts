import type { EvaluatorTable } from './types';

// Event nodes only start runs; the runner follows their output directly.
export const EVENT_EVALUATORS = {
 'event.manual': {},
 'event.keystroke': {},
 'event.enable': {},
 'event.update': { data: (_n, _o, _r, _s, env) => env.deltaSeconds },
} satisfies Partial<EvaluatorTable>;
