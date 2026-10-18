import type { EvaluatorTable } from './types';

export const SWITCH_EVALUATORS = {
 'switch.string': { flow: (node, c) => { const index = node.settings.cases.indexOf(c.read('value') as string); c.follow(index < 0 ? 'default' : `case${index}`); } },
 'switch.integer': { flow: (node, c) => { const index = node.settings.cases.indexOf(c.read('value') as number); c.follow(index < 0 ? 'default' : `case${index}`); } },
} satisfies Partial<EvaluatorTable>;
