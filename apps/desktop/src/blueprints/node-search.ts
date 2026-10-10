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
export function searchNodes(query: string, refs: DefaultRefs, need?: WireNeed): SearchGroup[] {
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
 return NODE_CATEGORIES.flatMap(category => {
  const entries = groups.get(category);
  if (!entries) return [];
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  return [{ category, best: sorted[0]!.rank, entries: sorted.map(({ rank: _rank, ...entry }) => entry) }];
 }).sort((a, b) => a.best - b.best).map(({ category, entries }) => ({ category, entries }));
}
