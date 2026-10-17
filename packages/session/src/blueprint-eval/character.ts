import type { EvaluatorTable } from './types';

export const CHARACTER_EVALUATORS = {
 'character.setExpression': { flow: (node, c) => c.emit({ kind: 'setExpression', entityId: node.settings.entityId, expression: node.settings.expression, active: Boolean(c.read('active')) }) },
 'character.toggleExpression': { flow: (node, c) => c.emit({ kind: 'toggleExpression', entityId: node.settings.entityId, expression: node.settings.expression }) },
} satisfies Partial<EvaluatorTable>;
