// Palette favorites and collapsed sections are per user, not per show: they live in the Editor window storage.
export const PALETTE_KEY = 'opensekai.blueprint.palette';
const LIMIT = 64, MAX_ID = 128;

export interface PaletteState { favorites: string[]; collapsed: string[] }
export interface PalettePrefs {
 state(): PaletteState;
 toggleFavorite(type: string): void;
 setCollapsed(keys: readonly string[]): void;
 subscribe(fn: (state: PaletteState) => void): () => void;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const ids = (value: unknown): string[] => Array.isArray(value)
 ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_ID))].slice(0, LIMIT)
 : [];
// Bad or missing data gives the empty state.
export function parsePalette(text: string | null): PaletteState {
 try {
  const raw: unknown = text === null ? null : JSON.parse(text);
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return { favorites: ids(record.favorites), collapsed: ids(record.collapsed) };
 } catch { return { favorites: [], collapsed: [] }; }
}
// A new favorite goes last, so the Favorites section keeps the order the user starred them in.
export const toggled = (favorites: readonly string[], type: string): string[] =>
 favorites.includes(type) ? favorites.filter(item => item !== type) : [...favorites, type].slice(-LIMIT);

const browserStorage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function createPalettePrefs(storage: Storage | null = browserStorage()): PalettePrefs {
 let current = (() => { try { return parsePalette(storage?.getItem(PALETTE_KEY) ?? null); } catch { return parsePalette(null); } })();
 const listeners = new Set<(state: PaletteState) => void>();
 const save = (next: PaletteState) => {
  current = next;
  try { storage?.setItem(PALETTE_KEY, JSON.stringify(next)); } catch { /* the palette state is a convenience only */ }
  for (const fn of listeners) fn(current);
 };
 return {
  state: () => current,
  toggleFavorite: type => save({ ...current, favorites: toggled(current.favorites, type) }),
  setCollapsed: keys => save({ ...current, collapsed: ids(keys) }),
  subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
 };
}
