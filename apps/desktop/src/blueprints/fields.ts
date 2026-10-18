import { HUMANOID_BONES, KEYSTROKE_CODES, propertiesFor, type BlueprintVariable, type PropertyKey, type SceneView } from '@opensekai/contracts';

export function parseCases(text: string): number[] | null {
 const parts = text.split(',').map(part => part.trim()).filter(part => part !== '');
 if (parts.length < 1 || parts.length > 8 || !parts.every(part => /^-?\d+$/.test(part))) return null;
 const cases = parts.map(Number);
 return new Set(cases).size === cases.length && cases.every(value => Math.abs(value) <= 1e6) ? cases : null;
}
export const formatCases = (cases: readonly number[]): string => cases.join(', ');
export function newVariable(existing: readonly BlueprintVariable[], type: 'number' | 'boolean', id: string): BlueprintVariable {
 const label = type === 'number' ? 'Number' : 'Boolean', names = new Set(existing.map(variable => variable.name));
 let n = 1;
 while (names.has(`${label} ${n}`)) n++;
 return type === 'number' ? { id, name: `${label} ${n}`, type, default: 0 } : { id, name: `${label} ${n}`, type, default: false };
}
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
