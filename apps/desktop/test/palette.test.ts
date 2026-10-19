import { expect, it } from 'vitest';
import { NODE_CATEGORIES, NODE_DEFINITIONS, type DefaultRefs } from '@opensekai/contracts';
import { FAVORITES, paletteSections, searchNodes, sectionCount } from '../src/blueprints/node-search';
import { createPalettePrefs, PALETTE_KEY, parsePalette, toggled } from '../src/blueprints/palette-prefs';

const refs: DefaultRefs = { entityId: 'e', cameraId: 'c', outputId: 'o', keystroke: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, variables: [{ id: 'n', type: 'number' }] };
const none = { favorites: [], collapsed: [] };
const memory = (initial: string | null = null) => {
 const data = new Map<string, string>(initial === null ? [] : [[PALETTE_KEY, initial]]);
 return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

it('has one section per available category in catalog order, with each count', () => {
 const view = paletteSections('', refs, none);
 const groups = searchNodes('', refs);
 expect(view.searching).toBe(false);
 expect(view.sections.map(section => section.key)).toEqual(NODE_CATEGORIES.filter(category => groups.some(group => group.category === category)));
 for (const section of view.sections) {
  const available = NODE_DEFINITIONS.filter(definition => definition.category === section.key && definition.defaults(refs) !== null).length;
  expect([section.count, section.total, section.open]).toEqual([available, available, true]);
  expect(sectionCount(section, false)).toBe(String(available));
 }
});

it('collapses saved sections, and opens every matching section during a search with a match/total count', () => {
 const collapsed = paletteSections('', refs, { favorites: [], collapsed: ['Math', 'Flow'] });
 expect(collapsed.sections.filter(section => !section.open).map(section => section.key)).toEqual(['Flow', 'Math']);
 const search = paletteSections('random', refs, { favorites: [], collapsed: ['Math'] });
 const math = search.sections.find(section => section.key === 'Math')!;
 expect(search.searching).toBe(true);
 expect(math.open).toBe(true);
 expect(math.entries.map(entry => entry.type)).toEqual(['math.random', 'integer.random']);
 expect(sectionCount(math, true)).toBe(`2/${collapsed.sections.find(section => section.key === 'Math')!.total}`);
 // An empty query brings the saved state back.
 expect(paletteSections('  ', refs, { favorites: [], collapsed: ['Math'] }).sections.find(section => section.key === 'Math')!.open).toBe(false);
});

it('puts favorites first in star order, keeps them in their category, and skips unregistered types', () => {
 const prefs = { favorites: ['math.random', 'gone.node', 'event.manual'], collapsed: [] };
 const view = paletteSections('', refs, prefs);
 const [first] = view.sections;
 expect(first!.key).toBe(FAVORITES);
 expect(first!.entries.map(entry => entry.type)).toEqual(['math.random', 'event.manual']);
 expect(first!.total).toBe(2);
 expect(view.sections.find(section => section.key === 'Math')!.entries.some(entry => entry.type === 'math.random')).toBe(true);
 expect(paletteSections('', refs, { favorites: ['gone.node'], collapsed: [] }).sections[0]!.key).not.toBe(FAVORITES);
 // During a search the Favorites section shows only matches and hides when none match.
 expect(paletteSections('random', refs, prefs).sections[0]!.entries.map(entry => entry.type)).toEqual(['math.random']);
 expect(paletteSections('hotkey', refs, prefs).sections[0]!.key).not.toBe(FAVORITES);
 expect(paletteSections('', refs, { ...prefs, collapsed: [FAVORITES] }).sections[0]!.open).toBe(false);
});

it('puts a favorite before a non-favorite with the same match rank, and filters by a wire need', () => {
 const plain = searchNodes('variable', refs).find(group => group.category === 'Variables')!.entries.map(entry => entry.type);
 const last = plain.at(-1)!;
 const starred = searchNodes('variable', refs, undefined, [last]).find(group => group.category === 'Variables')!.entries.map(entry => entry.type);
 expect(starred[0]).toBe(last);
 const need = { side: 'inputs' as const, type: 'boolean' as const };
 const view = paletteSections('', refs, { favorites: ['math.add', 'flow.branch'], collapsed: [] }, need);
 expect(view.sections[0]!.entries.map(entry => entry.type)).toEqual(['flow.branch']);
 expect(view.sections[0]!.entries[0]!.port).toBe('condition');
});

it('reads bad or missing storage as the empty state and bounds what it keeps', () => {
 expect(parsePalette(null)).toEqual(none);
 expect(parsePalette('{nope')).toEqual(none);
 expect(parsePalette('[1,2]')).toEqual(none);
 expect(parsePalette(JSON.stringify({ favorites: ['a', 'a', 3, '', 'b'], collapsed: 'Math' }))).toEqual({ favorites: ['a', 'b'], collapsed: [] });
 expect(parsePalette(JSON.stringify({ favorites: Array.from({ length: 70 }, (_, i) => `t${i}`), collapsed: [] })).favorites).toHaveLength(64);
 expect(toggled(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
 expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
});

it('persists favorites and collapsed sections and tells each subscriber', () => {
 const storage = memory(JSON.stringify({ favorites: ['math.add'], collapsed: [] }));
 const prefs = createPalettePrefs(storage);
 const seen: string[][] = [];
 const off = prefs.subscribe(state => { seen.push(state.favorites); });
 prefs.toggleFavorite('flow.gate');
 prefs.toggleFavorite('math.add');
 prefs.setCollapsed(['Math', 'Math', FAVORITES]);
 off();
 prefs.toggleFavorite('math.add');
 expect(seen).toEqual([['math.add', 'flow.gate'], ['flow.gate'], ['flow.gate']]);
 expect(createPalettePrefs(storage).state()).toEqual({ favorites: ['flow.gate', 'math.add'], collapsed: ['Math', FAVORITES] });
 const broken = createPalettePrefs({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
 broken.toggleFavorite('math.add');
 expect(broken.state().favorites).toEqual(['math.add']);
 expect(createPalettePrefs(null).state()).toEqual(none);
});
