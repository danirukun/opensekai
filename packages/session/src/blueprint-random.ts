export const fnv1a = (text: string): number => {
 let hash = 0x811c9dc5;
 for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
 return hash >>> 0;
};
// mulberry32: one step gives a value in [0, 1) and the next state.
export const nextRandom = (state: number): { value: number; state: number } => {
 const next = (state + 0x6d2b79f5) >>> 0;
 let t = next;
 t = Math.imul(t ^ (t >>> 15), t | 1);
 t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
 return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
};
