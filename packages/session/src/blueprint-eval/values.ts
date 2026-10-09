import type { EvaluatorTable } from './types';

export const VALUE_EVALUATORS = {
 'value.number': { data: node => node.settings.value },
 'value.boolean': { data: node => node.settings.value },
 'math.add': { data: (_node, _output, read) => Number(read('a')) + Number(read('b')) },
 'logic.greater': { data: (_node, _output, read) => Number(read('a')) > Number(read('b')) },
 'logic.not': { data: (_node, _output, read) => !read('value') },
} satisfies Partial<EvaluatorTable>;
