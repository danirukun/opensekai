import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { applyTheme, parseTheme, resolveTheme, THEME_KEY } from '../src/editor/theme';

const root = fileURLToPath(new URL('..', import.meta.url));
const boot = readFileSync(join(root, 'public/theme-boot.js'), 'utf8');

const page = () => ({ dataset: {} as Record<string, string | undefined>, style: {} as Record<string, string> });
const marks = (element: ReturnType<typeof page>) => ({ ...element.dataset, scheme: element.style.colorScheme });

// Runs the classic head script with a stand-in page and returns what it set on <html>.
const run = (stored: string | null, systemDark: boolean, storageFails = false) => {
 const element = page();
 runInNewContext(boot, {
  localStorage: { getItem: (key: string) => { if (storageFails) throw new Error('blocked'); return key === THEME_KEY ? stored : null; } },
  matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark }),
  document: { documentElement: element },
 });
 return marks(element);
};
// What the editor module sets for the same input.
const expected = (stored: string | null, systemDark: boolean) => {
 const element = page();
 applyTheme(resolveTheme(parseTheme(stored), systemDark), element as unknown as HTMLElement);
 return marks(element);
};

it('applies the same theme as resolveTheme and applyTheme before the editor module runs', () => {
 for (const stored of ['system', 'light', 'dark', 'dark-navy', null, 'x']) {
  for (const systemDark of [true, false]) {
   expect(run(stored, systemDark), `${stored} ${systemDark}`).toEqual(expected(stored, systemDark));
  }
 }
 expect(run('dark-navy', false)).toEqual({ theme: 'dark', palette: 'navy', scheme: 'dark' });
});

it('follows the OS when the storage is not available', () => {
 expect(run('light', true, true)).toEqual({ theme: 'dark', scheme: 'dark' });
 expect(run('dark-navy', false, true)).toEqual({ theme: 'light', scheme: 'light' });
});
