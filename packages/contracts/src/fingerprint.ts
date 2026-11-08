const canonical = (v: unknown): string =>
 Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
 : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
 : JSON.stringify(v) ?? 'null';

const MASK = 0xffffffffffffffffn;

// FNV-1a 64 over canonical JSON (sorted keys, no spaces), as 16 lower-case hex digits.
export function fingerprint(value: unknown): string {
 let h = 0xcbf29ce484222325n;
 for (const byte of new TextEncoder().encode(canonical(value))) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & MASK;
 return h.toString(16).padStart(16, '0');
}
