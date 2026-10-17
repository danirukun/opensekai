import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { blueprintNodeCatalog } from '@opensekai/contracts';
import { categoryCoverage, checkNodeAudit, type NodeAudit } from '../src/node-audit';

const audit = (nodes: NodeAudit['nodes']): NodeAudit => ({ warudoSource: 'test', warudoPalette: { 'Flow Control': 20, Literals: 31 }, nodes });
const row = (type: string, warudoCategory: string | null = 'Flow Control') => ({ type, warudoCategory, warudoCandidate: null, evidence: 'tests' as const });

it('reports catalog types without a row, rows without a type, duplicate rows, and unknown categories', () => {
    const problems = checkNodeAudit([{ type: 'flow.gate' }, { type: 'flow.delay' }, { type: 'value.number' }],
        audit([row('flow.gate'), row('flow.gate'), row('flow.removed'), row('value.number', 'Values')]));
    expect(problems).toEqual({ unaudited: ['flow.delay'], stale: ['flow.removed'], duplicate: ['flow.gate'], unknownCategory: ['value.number'] });
});

it('accepts a node with no Warudo counterpart', () => {
    expect(checkNodeAudit([{ type: 'event.manual' }], audit([row('event.manual', null)])))
        .toEqual({ unaudited: [], stale: [], duplicate: [], unknownCategory: [] });
});

it('counts OpenSekai nodes in each Warudo palette category', () => {
    expect(categoryCoverage(audit([row('flow.gate'), row('flow.delay'), row('event.manual', null)])))
        .toEqual([{ category: 'Flow Control', warudo: 20, opensekai: 2 }, { category: 'Literals', warudo: 31, opensekai: 0 }]);
});

// A new node type fails here until docs/evaluation/blueprint-node-audit.json has a row for it.
it('has one audit row for each node type in the live catalog', () => {
    const file = JSON.parse(readFileSync(new URL('../../../docs/evaluation/blueprint-node-audit.json', import.meta.url), 'utf8')) as NodeAudit;
    expect(checkNodeAudit(blueprintNodeCatalog(), file)).toEqual({ unaudited: [], stale: [], duplicate: [], unknownCategory: [] });
    expect(Object.values(file.warudoPalette).reduce((sum, count) => sum + count, 0)).toBe(519);
});
