import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importBlueprint, makeSmokeScene } from '../src';
import { FIXTURE_NAMES, FIXTURE_TEXT, VALID_FIXTURES } from './blueprint-fixtures';

const path = (name: string) => new URL(`../../../fixtures/blueprints/${name}.json`, import.meta.url);
// UPDATE_BLUEPRINT_FIXTURES=1 writes the files from the sources in blueprint-fixtures.ts.
if (process.env.UPDATE_BLUEPRINT_FIXTURES === '1') {
 mkdirSync(new URL('../../../fixtures/blueprints/', import.meta.url), { recursive: true });
 for (const name of FIXTURE_NAMES) writeFileSync(path(name), FIXTURE_TEXT[name]!);
}

it('keeps each fixture file equal to its source', () => {
 expect(FIXTURE_NAMES).toHaveLength(11);
 for (const name of FIXTURE_NAMES) expect(readFileSync(path(name), 'utf8'), name).toBe(FIXTURE_TEXT[name]);
});

it('imports each valid fixture into the smoke scene', () => {
 for (const name of VALID_FIXTURES) expect(importBlueprint(FIXTURE_TEXT[name]!, makeSmokeScene(), () => 'x').ok, name).toBe(true);
});
