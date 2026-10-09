import { NODE_CATEGORIES, NODE_DEFINITIONS, type BlueprintKind, type DefaultRefs, type NodeCategory, type PortType } from '@opensekai/contracts';

export interface WireNeed { side: 'inputs' | 'outputs'; type: PortType }
export interface SearchEntry { type: BlueprintKind; label: string; port?: string }
export interface SearchGroup { category: NodeCategory; entries: SearchEntry[] }

// Every word must appear in the label, category, or keywords.
export function searchNodes(query: string, refs: DefaultRefs, need?: WireNeed): SearchGroup[] {
 const words = query.toLowerCase().split(/\s+/).filter(Boolean);
 const groups = new Map<NodeCategory, SearchEntry[]>();
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
  list.push({ type: definition.type, label: definition.label, ...(port === undefined ? {} : { port }) });
  groups.set(definition.category, list);
 }
 return NODE_CATEGORIES.flatMap(category => { const entries = groups.get(category); return entries ? [{ category, entries }] : []; });
}
