import type { BlueprintVariable } from '@opensekai/contracts';

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
