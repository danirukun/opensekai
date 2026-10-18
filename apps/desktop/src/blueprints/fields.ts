import { DATA_TYPE_LABELS, DATA_TYPES, defaultBlueprintValue, HUMANOID_BONES, isBlueprintValue, isListType, itemType, KEYSTROKE_CODES, MAX_BLUEPRINT_LIST_LENGTH, propertiesFor, type BlueprintValue, type BlueprintVariable, type DataType, type ListType, type PropertyKey, type ScalarType, type ScalarValue, type SceneView, type Vec3 } from '@opensekai/contracts';

export function parseCases(text: string): number[] | null {
 const parts = text.split(',').map(part => part.trim()).filter(part => part !== '');
 if (parts.length < 1 || parts.length > 8 || !parts.every(part => /^-?\d+$/.test(part))) return null;
 const cases = parts.map(Number);
 return new Set(cases).size === cases.length && cases.every(value => Math.abs(value) <= 1e6) ? cases : null;
}
export const formatCases = (cases: readonly number[]): string => cases.join(', ');
export const dataTypeOptions = () => DATA_TYPES.map(type => ({ value: type, label: DATA_TYPE_LABELS[type] }));
export const asDataType = (text: string): DataType | null => (DATA_TYPES as readonly string[]).includes(text) ? text as DataType : null;
export function newVariable(existing: readonly BlueprintVariable[], type: DataType, id: string): BlueprintVariable {
 const label = DATA_TYPE_LABELS[type], names = new Set(existing.map(variable => variable.name));
 let n = 1;
 while (names.has(`${label} ${n}`)) n++;
 return { id, name: `${label} ${n}`, type, default: defaultBlueprintValue(type) } as BlueprintVariable;
}
// One scalar value from the text of an inline or default editor, or null when the text does not fit the type.
// A Vector3 is `x, y, z`. Boolean editors are checkboxes and do not use text.
export function parseScalar(type: Exclude<ScalarType, 'boolean'>, text: string): ScalarValue | null {
 const number = (part: string) => part.trim() === '' ? Number.NaN : Number(part);
 const value: unknown = type === 'string' ? text
  : type === 'vector3' ? (parts => parts.length === 3 ? parts.map(number) : null)(text.split(','))
  : number(text);
 return value !== null && isBlueprintValue(type, value) ? value as ScalarValue : null;
}
const formatScalar = (value: ScalarValue): string => Array.isArray(value) ? value.join(', ') : String(value);
// A list default as text: one item on each line.
export const formatList = (values: readonly ScalarValue[]): string => values.map(formatScalar).join('\n');
export function parseList(type: ListType, text: string): BlueprintValue | null {
 const item = itemType(type), lines = text.split('\n').map(line => item === 'string' ? line : line.trim()).filter(line => line !== '');
 if (lines.length > MAX_BLUEPRINT_LIST_LENGTH) return null;
 const items = lines.map(line => item === 'boolean' ? ({ true: true, false: false } as Record<string, boolean>)[line.toLowerCase()] ?? null : parseScalar(item, line));
 return items.every(value => value !== null) && isBlueprintValue(type, items) ? items as BlueprintValue : null;
}
export const vectorParts = (value: Vec3, index: number, text: string): Vec3 | null => {
 const part = parseScalar('number', text);
 return part === null ? null : value.map((item, i) => i === index ? part : item) as Vec3;
};
export function keyLabel(code: string): string {
 if (code.startsWith('Key')) return code.slice(3);
 if (code.startsWith('Digit')) return code.slice(5);
 if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
 if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
 return code;
}
export const keyOptions = () => KEYSTROKE_CODES.map(code => ({ value: code, label: keyLabel(code) }));
export function propertyOptions(scene: SceneView | null, entityId: string): { value: PropertyKey; label: string }[] {
 const kind = scene?.entities.find(entity => entity.id === entityId)?.kind;
 return kind ? propertiesFor(kind).map(property => ({ value: property.key, label: property.label })) : [];
}
// An entity change can leave a property the new entity lacks; Position applies to every placed entity.
export function fitPropertySettings<S extends { entityId: string; property: PropertyKey }>(settings: S, scene: SceneView | null): S {
 const options = propertyOptions(scene, settings.entityId);
 return options.length === 0 || options.some(option => option.value === settings.property) ? settings : { ...settings, property: 'position' };
}
const words = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase());
export const boneOptions = () => HUMANOID_BONES.map(bone => ({ value: bone, label: words(bone) }));
