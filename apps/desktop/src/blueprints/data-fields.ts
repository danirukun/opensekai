import { DATA_TYPE_LABELS, isListType, MAX_BLUEPRINT_STRING_LENGTH, type BlueprintVariable, type DataType } from '@opensekai/contracts';

const MAX_CASES = 8;
// One case on each line. Empty lines are ignored; the text is kept as typed.
export function parseStringCases(text: string): string[] | null {
 const cases = text.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line !== '');
 return cases.length >= 1 && cases.length <= MAX_CASES && new Set(cases).size === cases.length && cases.every(item => item.length <= MAX_BLUEPRINT_STRING_LENGTH) ? cases : null;
}
export const formatStringCases = (cases: readonly string[]): string => cases.join('\n');
export const typedVariableOptions = (variables: readonly BlueprintVariable[], lists: boolean) =>
 variables.filter(variable => !lists || isListType(variable.type)).map(variable => ({ value: variable.id, label: variable.name }));
// The settings after a variable choice: the ID and the type of the variable, in one change.
export function chooseTypedVariable<S extends Record<string, unknown>>(settings: S, key: string, typeKey: string, variables: readonly BlueprintVariable[], id: string): S | null {
 const variable = variables.find(item => item.id === id);
 return variable ? { ...settings, [key]: id, [typeKey]: variable.type } : null;
}
export const typeOptions = (types: readonly DataType[]) => types.map(type => ({ value: type, label: DATA_TYPE_LABELS[type] }));
// A list of types resized to `count`: kept entries stay, new entries take the first option.
export const resizeTypes = <T extends DataType>(types: readonly T[], count: number, fallback: T): T[] =>
 Array.from({ length: count }, (_, i) => types[i] ?? fallback);
