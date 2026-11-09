// Like JSON, an object skips a key whose value is undefined, and an array writes undefined as null.
const canonical = (v: unknown): string =>
 Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
 : v !== null && typeof v === 'object' ? (o => `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`)(v as Record<string, unknown>)
 : JSON.stringify(v) ?? 'null';

const MASK = 0xffffffffffffffffn;

// FNV-1a 64 over canonical JSON (sorted keys, no spaces), as 16 lower-case hex digits.
export function fingerprint(value: unknown): string {
 let h = 0xcbf29ce484222325n;
 for (const byte of new TextEncoder().encode(canonical(value))) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & MASK;
 return h.toString(16).padStart(16, '0');
}
