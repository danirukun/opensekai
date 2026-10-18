import { z } from 'zod';
import { DATA_TYPE_LABELS, listOf, SCALAR_TYPES, type ScalarType } from '../blueprint-values';
import { defineNode, numbered, type BlueprintField, type PortShape, type PortType } from './define';

const ItemType = z.enum(SCALAR_TYPES);
export const itemTypeField: BlueprintField = { key: 'itemType', label: 'Item type', kind: 'choice', options: SCALAR_TYPES.map(value => ({ value, label: DATA_TYPE_LABELS[value] })) };
const typed = z.strictObject({ itemType: ItemType });
type Typed = { itemType: ScalarType };
const list = <const T extends string>(type: T, label: string, keywords: string[], ports: (item: ScalarType, list: PortType) => PortShape) =>
 defineNode({ type, label, category: 'Lists', keywords: ['list', 'array', ...keywords], settings: typed, ports: (s: Typed) => ports(s.itemType, listOf(s.itemType)), defaults: () => ({ itemType: 'string' as ScalarType }), fields: [itemTypeField], dynamicPorts: true });

export const LIST_NODES = [
 defineNode({ type: 'list.make', label: 'Make List', category: 'Lists', keywords: ['list', 'array', 'create', 'build', 'new'], settings: z.strictObject({ itemType: ItemType, count: z.number().int().min(0).max(8) }), ports: s => ({ inputs: numbered('item', s.count, s.itemType), outputs: { result: listOf(s.itemType) } }), defaults: () => ({ itemType: 'string' as ScalarType, count: 2 }), fields: [itemTypeField, { key: 'count', label: 'Items', kind: 'count', min: 0, max: 8 }], dynamicPorts: true }),
 list('list.get', 'Get List Item', ['get', 'item', 'index', 'at', 'element'], (item, l) => ({ inputs: { list: l, index: 'integer' }, outputs: { item, ok: 'boolean' } })),
 list('list.length', 'List Length', ['length', 'count', 'size'], (_item, l) => ({ inputs: { list: l }, outputs: { length: 'integer' } })),
 list('list.append', 'Append To List', ['append', 'add', 'push'], (item, l) => ({ inputs: { list: l, item }, outputs: { result: l } })),
 list('list.insert', 'Insert Into List', ['insert', 'add', 'at'], (item, l) => ({ inputs: { list: l, index: 'integer', item }, outputs: { result: l, ok: 'boolean' } })),
 list('list.removeAt', 'Remove List Item', ['remove', 'delete', 'at'], (_item, l) => ({ inputs: { list: l, index: 'integer' }, outputs: { result: l, ok: 'boolean' } })),
 list('list.set', 'Set List Item', ['set', 'replace', 'item', 'at'], (item, l) => ({ inputs: { list: l, index: 'integer', item }, outputs: { result: l, ok: 'boolean' } })),
 list('list.contains', 'List Contains', ['contains', 'includes', 'has'], (item, l) => ({ inputs: { list: l, item }, outputs: { result: 'boolean' } })),
 list('list.indexOf', 'List Index Of', ['index', 'find', 'search', 'position'], (item, l) => ({ inputs: { list: l, item }, outputs: { index: 'integer' } })),
 list('list.random', 'Random List Item', ['random', 'pick', 'choose', 'shuffle'], (item, l) => ({ inputs: { list: l }, outputs: { item, ok: 'boolean' } })),
 list('list.forEach', 'For Each', ['loop', 'each', 'iterate', 'repeat'], (item, l) => ({ inputs: { flow: 'flow', list: l }, outputs: { body: 'flow', item, index: 'integer', completed: 'flow' } })),
] as const;
