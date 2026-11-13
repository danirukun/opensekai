import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../src', import.meta.url));
const logo = readFileSync(join(root, 'assets/opensekai-logo.svg'), 'utf8');
const mark = readFileSync(join(root, 'components/OpenSekaiMark.svelte'), 'utf8');
const paths = (source: string) => [...source.matchAll(/\sd="([^"]+)"/g)].map(match => match[1]);

it('commits the cube and sparkles as one full-colour asset with the brand lime face', () => {
  expect(logo).toContain('viewBox="0 -68 733 712"');
  expect(logo).toContain('fill="#D1FFA5"');
  expect(logo).toContain('fill="#83E7FF"');
  expect(logo).toContain('fill="#E7A0FE"');
  expect(logo.toLowerCase()).not.toContain('#ccfe9d');
  expect(logo.toLowerCase()).not.toContain('#00017f');
  expect(paths(logo)).toHaveLength(3);
});

it('uses the same cube and sparkle paths for the rail mark, in one colour', () => {
  expect(paths(mark)).toEqual(paths(logo));
  expect(mark).toContain('fill="currentColor"');
  expect(mark).not.toMatch(/#[0-9a-fA-F]{3,8}/);
});

it('puts the rail mark first and opens the Assets tab from it', () => {
  const app = readFileSync(join(root, 'EditorApp.svelte'), 'utf8');
  const rail = app.slice(app.indexOf('class="editor-rail"'), app.indexOf('class="editor-content"'));
  const markAt = rail.indexOf('<OpenSekaiMark/>');
  const boxAt = rail.indexOf('<Box');
  const resourcesAt = rail.indexOf('title="Resources"');
  expect(markAt).toBeGreaterThan(-1);
  expect(markAt).toBeLessThan(boxAt);
  expect(markAt).toBeLessThan(resourcesAt);
  const logoButton = rail.slice(0, boxAt);
  expect(logoButton).toContain("panel==='assets'");
  expect(logoButton).not.toContain('resources');
});
