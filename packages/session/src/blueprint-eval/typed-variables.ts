import { itemType, type BlueprintValue } from '@opensekai/contracts';
import { checkBlueprintValue, type EvaluatorTable, type FlowContext } from './types';

// Each write is checked, so a failed check fails the run before state is kept.
const write = (c: FlowContext, variableId: string, type: Parameters<typeof checkBlueprintValue>[0], value: BlueprintValue) => {
 checkBlueprintValue(type, value);
 c.state.variables.set(variableId, value);
 c.follow('exit');
};
export const TYPED_VARIABLE_EVALUATORS = {
 'variable.get': { data: (node, _o, _r, state) => state.variables.get(node.settings.variableId)! },
 'variable.set': { flow: (node, c) => write(c, node.settings.variableId, node.settings.type, c.read('value')) },
 'variable.appendList': { flow: (node, c) => {
  const list = c.state.variables.get(node.settings.variableId) as readonly BlueprintValue[];
  const item = c.read('item');
  checkBlueprintValue(itemType(node.settings.type), item);
  write(c, node.settings.variableId, node.settings.type, [...list, item] as BlueprintValue);
 } },
 'variable.clearList': { flow: (node, c) => write(c, node.settings.variableId, node.settings.type, []) },
 'variable.incrementInteger': { flow: (node, c) =>
  write(c, node.settings.variableId, 'integer', (c.state.variables.get(node.settings.variableId) as number) + (c.read('amount') as number)) },
} satisfies Partial<EvaluatorTable>;
