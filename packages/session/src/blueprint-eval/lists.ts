import { defaultBlueprintValue, MAX_BLUEPRINT_LIST_LENGTH, type BlueprintValue, type ScalarValue } from '@opensekai/contracts';
import { nextRandom } from '../blueprint-random';
import { indexOfValue, inRange, insertAt, removeAt, setAt } from './data-helpers';
import { getNodeState, setNodeState, type EvaluatorTable, type Read } from './types';

type List = readonly ScalarValue[];
// A list of one item type; the runtime checks the item type of each output.
const value = (list: List) => list as BlueprintValue;
const listOf = (read: Read) => read('list') as List;
const indexOf = (read: Read) => read('index') as number;
const item = (read: Read) => read('item') as ScalarValue;
// An index node gives the changed list and true, or the list with no change and false.
const indexed = (output: string, list: List, ok: boolean, change: () => List): BlueprintValue => output === 'ok' ? ok : value(ok ? change() : list);

export const LIST_EVALUATORS = {
 'list.make': { data: (node, _o, read) => value(Array.from({ length: node.settings.count }, (_, i) => read(`item${i}`) as ScalarValue)) },
 'list.get': { data: (node, output, read) => {
  const list = listOf(read), index = indexOf(read), ok = inRange(list, index);
  return output === 'ok' ? ok : ok ? list[index]! : defaultBlueprintValue(node.settings.itemType);
 } },
 'list.length': { data: (_n, _o, read) => listOf(read).length },
 'list.append': { data: (_n, _o, read) => value([...listOf(read), item(read)]) },
 'list.insert': { data: (_n, output, read) => { const list = listOf(read), index = indexOf(read); return indexed(output, list, inRange(list, index, true), () => insertAt(list, index, item(read))); } },
 'list.removeAt': { data: (_n, output, read) => { const list = listOf(read), index = indexOf(read); return indexed(output, list, inRange(list, index), () => removeAt(list, index)); } },
 'list.set': { data: (_n, output, read) => { const list = listOf(read), index = indexOf(read); return indexed(output, list, inRange(list, index), () => setAt(list, index, item(read))); } },
 'list.contains': { data: (_n, _o, read) => indexOfValue(listOf(read), item(read)) >= 0 },
 'list.indexOf': { data: (_n, _o, read) => indexOfValue(listOf(read), item(read)) },
 'list.random': { data: (node, output, read, state) => {
  const list = listOf(read);
  if (output === 'ok') return list.length > 0;
  if (list.length === 0) return defaultBlueprintValue(node.settings.itemType);
  const step = nextRandom(state.random);
  state.random = step.state;
  return list[Math.min(Math.floor(step.value * list.length), list.length - 1)]!;
 } },
 // For Each keeps the list it read when flow entered, so `item` does not read the list again in the body.
 'list.forEach': {
  data: (node, output, _read, state) => {
   const index = state.loops.get(node.id) ?? 0;
   if (output === 'index') return index;
   return getNodeState<List>(state, node.id)?.[index] ?? defaultBlueprintValue(node.settings.itemType);
  },
  // The loop ends with no saved list and index, so a later read outside the loop gives the defaults.
  flow: (node, c) => {
   const list = listOf(c.read);
   if (list.length > 0) setNodeState(c.state, node.id, list);
   c.loop(0, list.length - 1, { limit: MAX_BLUEPRINT_LIST_LENGTH, clear: true });
  },
 },
} satisfies Partial<EvaluatorTable>;
