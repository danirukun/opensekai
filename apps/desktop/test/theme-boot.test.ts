import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { parseTheme, resolveTheme, THEME_KEY } from '../src/editor/theme';

const root = fileURLToPath(new URL('..', import.meta.url));
const boot = readFileSync(join(root, 'public/theme-boot.js'), 'utf8');

// Runs the classic head script with a stand-in page and returns what it set on <html>.
const run = (stored: string | null, systemDark: boolean, storageFails = false) => {
 const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
 runInNewContext(boot, {
  localStorage: { getItem: (key: string) => { if (storageFails) throw new Error('blocked'); return key === THEME_KEY ? stored : null; } },
  matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark }),
  document: { documentElement: element },
 });
 return { theme: element.dataset.theme, scheme: element.style.colorScheme };
};

it('applies the same theme as resolveTheme before the editor module runs', () => {
 for (const stored of ['system', 'light', 'dark', null, 'x']) {
  for (const systemDark of [true, false]) {
   const expected = resolveTheme(parseTheme(stored), systemDark);
   expect(run(stored, systemDark), `${stored} ${systemDark}`).toEqual({ theme: expected, scheme: expected });
  }
 }
});

it('follows the OS when the storage is not available', () => {
 expect(run('light', true, true)).toEqual({ theme: 'dark', scheme: 'dark' });
 expect(run('dark', false, true)).toEqual({ theme: 'light', scheme: 'light' });
});
