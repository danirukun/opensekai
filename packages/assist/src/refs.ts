import type { Id } from '@opensekai/contracts';
import type { Ref } from './intents';

export type RefKind = 'entity' | 'blueprint' | 'asset';
export type RefTable = { entities: Record<Id, Ref>; blueprints: Record<Id, Ref>; assets: Record<Id, Ref>; next: { e: number; b: number; a: number }; owned: Id[] };

const SLOT = { entity: ['entities', 'e'], blueprint: ['blueprints', 'b'], asset: ['assets', 'a'] } as const;
const PREFIX: Record<string, RefKind> = { e: 'entity', b: 'blueprint', a: 'asset' };

export const emptyRefs = (): RefTable => ({ entities: {}, blueprints: {}, assets: {}, next: { e: 1, b: 1, a: 1 }, owned: [] });

const assignKind = (map: Record<Id, Ref>, next: number, letter: string, ids: Id[]) =>
 ids.reduce((s, id) => id in s.map ? s : { map: { ...s.map, [id]: `@${letter}${s.next}` as Ref }, next: s.next + 1 }, { map, next });

export const assignRefs = (table: RefTable, ids: { entities: Id[]; blueprints: Id[]; assets: Id[] }): RefTable => {
 const e = assignKind(table.entities, table.next.e, 'e', ids.entities);
 const b = assignKind(table.blueprints, table.next.b, 'b', ids.blueprints);
 const a = assignKind(table.assets, table.next.a, 'a', ids.assets);
 return { entities: e.map, blueprints: b.map, assets: a.map, next: { e: e.next, b: b.next, a: a.next }, owned: table.owned };
};

export const refOf = (table: RefTable, kind: RefKind, id: Id): Ref => table[SLOT[kind][0]][id]!;

export const resolveRef = (table: RefTable, ref: string): { kind: RefKind; id: Id } | null => {
 const kind = PREFIX[ref[1] ?? ''];
 if (!kind || ref[0] !== '@') return null;
 const id = Object.keys(table[SLOT[kind][0]]).find(k => table[SLOT[kind][0]][k] === ref);
 return id === undefined ? null : { kind, id };
};
