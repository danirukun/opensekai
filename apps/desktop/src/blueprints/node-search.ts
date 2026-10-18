import { NODE_CATEGORIES, NODE_DEFINITIONS, type BlueprintKind, type DefaultRefs, type NodeCategory, type PortType } from '@opensekai/contracts';

export interface WireNeed { side: 'inputs' | 'outputs'; type: PortType }
export interface SearchEntry { type: BlueprintKind; label: string; port?: string }
export interface SearchGroup { category: NodeCategory; entries: SearchEntry[] }

// 0: the label is the query; 1: the label starts with it; 2: each query word starts a label word; 3: any other match.
const rank = (label: string, words: readonly string[]): number => {
 const name = label.toLowerCase(), query = words.join(' '), labelWords = name.split(/\s+/);
 if (words.length === 0) return 3;
 return name === query ? 0 : name.startsWith(query) ? 1 : words.every(word => labelWords.some(part => part.startsWith(word))) ? 2 : 3;
};

// Every word must appear in the label, category, or keywords. Groups with a closer label match come first.
// In a group, a favorite comes before a non-favorite with the same rank.
export function searchNodes(query: string, refs: DefaultRefs, need?: WireNeed, favorites: readonly string[] = []): SearchGroup[] {
 const words = query.toLowerCase().split(/\s+/).filter(Boolean);
 const groups = new Map<NodeCategory, (SearchEntry & { rank: number })[]>();
 for (const definition of NODE_DEFINITIONS) {
  const settings = definition.defaults(refs);
  if (settings === null) continue;
  const text = [definition.label, definition.category, ...definition.keywords].join(' ').toLowerCase();
  if (!words.every(word => text.includes(word))) continue;
  let port: string | undefined;
  if (need) {
   const ports = definition.ports(settings as never)[need.side];
   port = Object.keys(ports).find(name => ports[name] === need.type);
   if (port === undefined) continue;
  }
  const list = groups.get(definition.category) ?? [];
  list.push({ type: definition.type, label: definition.label, rank: rank(definition.label, words), ...(port === undefined ? {} : { port }) });
  groups.set(definition.category, list);
 }
 const starred = (type: string) => favorites.includes(type) ? 0 : 1;
 return NODE_CATEGORIES.flatMap(category => {
  const entries = groups.get(category);
  if (!entries) return [];
  const sorted = [...entries].sort((a, b) => a.rank - b.rank || starred(a.type) - starred(b.type));
  return [{ category, best: sorted[0]!.rank, entries: sorted.map(({ rank: _rank, ...entry }) => entry) }];
 }).sort((a, b) => a.best - b.best).map(({ category, entries }) => ({ category, entries }));
}

export const FAVORITES = 'Favorites';
// `count` is the number of shown entries and `total` the number of available node types in the section.
export interface PaletteSection { key: string; entries: SearchEntry[]; count: number; total: number; open: boolean }
export interface PaletteView { searching: boolean; sections: PaletteSection[] }

// Sections for the palette: Favorites first (hidden when nothing in it matches), then one per category.
// During a search each section with a match is open; otherwise the saved collapse state applies.
export function paletteSections(query: string, refs: DefaultRefs, prefs: { favorites: readonly string[]; collapsed: readonly string[] }, need?: WireNeed): PaletteView {
 const searching = query.trim() !== '';
 const all = searchNodes('', refs, need);
 const totals = new Map(all.map(group => [group.category as string, group.entries.length] as const));
 const groups = searching ? searchNodes(query, refs, need, prefs.favorites) : all;
 const shown = new Map(groups.flatMap(group => group.entries).map(entry => [entry.type as string, entry] as const));
 const available = new Set(all.flatMap(group => group.entries.map(entry => entry.type as string)));
 const open = (key: string) => searching || !prefs.collapsed.includes(key);
 const favorites = prefs.favorites.flatMap(type => shown.get(type) ?? []);
 const starred: PaletteSection[] = favorites.length === 0 ? [] : [{
  key: FAVORITES, entries: favorites, count: favorites.length, total: prefs.favorites.filter(type => available.has(type)).length, open: open(FAVORITES),
 }];
 return { searching, sections: [...starred, ...groups.map(group => ({
  key: group.category, entries: group.entries, count: group.entries.length, total: totals.get(group.category) ?? group.entries.length, open: open(group.category),
 }))] };
}
export const sectionCount = (section: PaletteSection, searching: boolean) => searching ? `${section.count}/${section.total}` : `${section.total}`;
