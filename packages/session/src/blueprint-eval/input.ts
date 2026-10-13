import type { EvaluatorTable } from './types';

export const INPUT_EVALUATORS = {
 'input.keyHeld': { data: (node, _o, _r, _s, env) => env.held.has(node.settings.code) },
 'input.keyAxis': { data: (node, _o, _r, _s, env) => Number(env.held.has(node.settings.positive)) - Number(env.held.has(node.settings.negative)) },
} satisfies Partial<EvaluatorTable>;
