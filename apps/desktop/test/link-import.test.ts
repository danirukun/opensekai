import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { importBlueprint, makeSmokeScene } from '@opensekai/contracts';
import { countLine, linkSummary } from '../src/blueprints/link-import';

const load = (name: string) => readFileSync(new URL(`../../../fixtures/blueprints/${name}.json`, import.meta.url), 'utf8');
const host = 'blueprints.example';
const summary = (text: string, graphCount = 0) => linkSummary(text, host, makeSmokeScene(), graphCount, () => 'linked-graph');
const failure = (text: string, graphCount = 0) => { const reply = summary(text, graphCount); return reply.ok ? null : reply.error.message; };

it('builds the confirm content for a file with no missing reference and adds the graph disabled', () => {
 const text = load('counter');
 expect(JSON.parse(text).graph.enabled).toBe(true);
 const reply = summary(text);
 expect(reply).toMatchObject({ ok: true, data: { name: 'Counter', host, nodeCount: 7, missing: [], graph: { id: 'linked-graph', enabled: false } } });
});

it('lists missing references by name in the same form as a file import', () => {
 const text = load('missing-ref');
 const file = importBlueprint(text, makeSmokeScene(), () => 'x');
 if (!file.ok) throw new Error(file.error.message);
 const reply = summary(text);
 expect(reply.ok && reply.data.missing).toEqual(file.data.report.missing.map(item => item.name));
 expect(reply.ok && reply.data.missing.length).toBeGreaterThan(0);
 expect(reply.ok && reply.data.graph.enabled).toBe(false);
});

it('refuses a show with 8 graphs before it parses the text', () => {
 const newId = vi.fn(() => 'x');
 const reply = linkSummary(load('counter'), host, makeSmokeScene(), 8, newId);
 expect(reply).toMatchObject({ ok: false, error: { message: 'Show already has 8 blueprints' } });
 expect(newId).not.toHaveBeenCalled();
 expect(failure('not json', 8)).toBe('Show already has 8 blueprints');
 expect(summary(load('counter'), 7).ok).toBe(true);
});

it('keeps the file import messages for a file that does not import', () => {
 expect(failure(load('unknown-node'))).toBe('Unknown node types: character.wave');
 expect(failure(load('future-version'))).toBe('Blueprint file needs a newer OpenSekai');
 expect(failure(load('warudo-shaped'))).toBe('Not an OpenSekai Blueprint file');
 expect(failure(' '.repeat(1024 * 1024 + 1))).toBe('Blueprint file is too large');
});

it('writes the node count and the host on one line', () => {
 expect(countLine(1, 'h')).toBe('1 node · h');
 expect(countLine(7, 'h')).toBe('7 nodes · h');
 expect(countLine(0, 'h')).toBe('0 nodes · h');
});
