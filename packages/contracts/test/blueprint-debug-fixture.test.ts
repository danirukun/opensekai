import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-debug.json';
import { ResultSchemas } from '../src';

type Case = { name: string; fill?: 'entries' | 'values'; entry?: number; value?: number; change?: [string, unknown] };
// The same mutations as crates/contracts/tests/blueprint_debug.rs.
const mutate = (valid: typeof fixture.valid, item: Case) => {
 const data = structuredClone(valid) as Record<string, unknown> & { entries: Record<string, unknown>[]; values: Record<string, unknown>[] };
 if (item.fill) { data[item.fill] = Array.from({ length: item.fill === 'entries' ? 51 : 65 }, () => data[item.fill!][0]); return data; }
 const [key, raw] = item.change!;
 const value = raw === 'LONG_TEXT' ? 'x'.repeat(257) : raw === 'LONG_STRING' ? 'x'.repeat(1025) : raw;
 const target = item.entry !== undefined ? data.entries[item.entry]! : item.value !== undefined ? data.values[item.value]! : data;
 target[key] = value;
 return data;
};

it('accepts the shared debug reply and rejects each mutation', () => {
 expect(ResultSchemas.blueprintDebug.safeParse(fixture.valid).success).toBe(true);
 for (const item of fixture.invalid as Case[]) expect(ResultSchemas.blueprintDebug.safeParse(mutate(fixture.valid, item)).success, item.name).toBe(false);
});
