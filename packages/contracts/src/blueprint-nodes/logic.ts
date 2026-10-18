import { plainNodes, type PortShape } from './define';

const compare = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } });
const both = (): PortShape => ({ inputs: { a: 'boolean', b: 'boolean' }, outputs: { result: 'boolean' } });
const logic = plainNodes('Logic');
export const LOGIC_NODES = [
 logic('logic.greater', 'Greater Than', ['compare', '>', 'more'], compare),
 logic('logic.less', 'Less Than', ['compare', '<', 'fewer'], compare),
 logic('logic.greaterOrEqual', 'Greater or Equal', ['compare', '>=', 'at least'], compare),
 logic('logic.lessOrEqual', 'Less or Equal', ['compare', '<=', 'at most'], compare),
 logic('logic.equal', 'Equal', ['compare', '==', 'same'], compare),
 logic('logic.not', 'Not', ['invert', 'negate', '!'], () => ({ inputs: { value: 'boolean' }, outputs: { result: 'boolean' } })),
 logic('logic.and', 'And', ['both', '&&', 'all'], both),
 logic('logic.or', 'Or', ['either', '||', 'any'], both),
] as const;
