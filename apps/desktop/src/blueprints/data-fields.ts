import { isListType, MAX_SWITCH_CASES, type BlueprintVariable, type DataType } from '@opensekai/contracts';
import { formatList, parseList } from './fields';

// One case on each line as a JSON string, like a String List default, so an empty case and a case with a line break keep their value.
export function parseStringCases(text: string): string[] | null {
 const cases = parseList('string[]', text) as string[] | null;
 return cases && cases.length >= 1 && cases.length <= MAX_SWITCH_CASES && new Set(cases).size === cases.length ? cases : null;
}
export const formatStringCases = (cases: readonly string[]): string => formatList(cases);
export const typedVariableOptions = (variables: readonly BlueprintVariable[], lists: boolean) =>
 variables.filter(variable => !lists || isListType(variable.type)).map(variable => ({ value: variable.id, label: variable.name }));
// The settings after a variable choice: the ID and the type of the variable, in one change.
export function chooseTypedVariable<S extends Record<string, unknown>>(settings: S, key: string, typeKey: string, variables: readonly BlueprintVariable[], id: string): S | null {
 const variable = variables.find(item => item.id === id);
 return variable ? { ...settings, [key]: id, [typeKey]: variable.type } : null;
}
// A list of types resized to `count`: kept entries stay, new entries take `fallback`.
export const resizeTypes = <T extends DataType>(types: readonly T[], count: number, fallback: T): T[] =>
 Array.from({ length: count }, (_, i) => types[i] ?? fallback);
