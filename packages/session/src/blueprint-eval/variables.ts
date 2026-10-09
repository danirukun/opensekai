import type { EvaluatorTable } from './types';

export const VARIABLE_EVALUATORS = {
 'variable.getNumber': { data: (node, _o, _r, state) => state.variables.get(node.settings.variableId)! },
 'variable.getBoolean': { data: (node, _o, _r, state) => state.variables.get(node.settings.variableId)! },
 'variable.setNumber': { flow: (node, c) => { c.state.variables.set(node.settings.variableId, Number(c.read('value'))); c.follow('exit'); } },
 'variable.setBoolean': { flow: (node, c) => { c.state.variables.set(node.settings.variableId, Boolean(c.read('value'))); c.follow('exit'); } },
 'variable.addNumber': { flow: (node, c) => {
  const next = Number(c.state.variables.get(node.settings.variableId)) + Number(c.read('amount'));
  if (!Number.isFinite(next)) throw new RangeError('Blueprint number is not finite');
  c.state.variables.set(node.settings.variableId, next); c.follow('exit');
 } },
 'variable.toggleBoolean': { flow: (node, c) => { c.state.variables.set(node.settings.variableId, !c.state.variables.get(node.settings.variableId)); c.follow('exit'); } },
} satisfies Partial<EvaluatorTable>;
