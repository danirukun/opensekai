import type { EvaluatorTable } from './types';

export const LITERAL_EVALUATORS = {
 'value.integer': { data: node => node.settings.value },
 'value.string': { data: node => node.settings.value },
 'value.vector3': { data: node => node.settings.value },
} satisfies Partial<EvaluatorTable>;
