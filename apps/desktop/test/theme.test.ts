import { expect, it } from 'vitest';
import { applyTheme, nativeTheme, parseTheme, resolveTheme } from '../src/editor/theme';

it('reads a stored preference and falls back to system for missing or unknown text', () => {
 expect(parseTheme('system')).toBe('system');
 expect(parseTheme('light')).toBe('light');
 expect(parseTheme('dark')).toBe('dark');
 expect(parseTheme('dark-navy')).toBe('dark-navy');
 expect(parseTheme(null)).toBe('system');
 expect(parseTheme('x')).toBe('system');
});

it('follows the OS only for the system preference, and system never gives Dark Navy', () => {
 expect(resolveTheme('system', true)).toBe('dark');
 expect(resolveTheme('system', false)).toBe('light');
 for (const systemDark of [true, false]) {
  expect(resolveTheme('light', systemDark)).toBe('light');
  expect(resolveTheme('dark', systemDark)).toBe('dark');
  expect(resolveTheme('dark-navy', systemDark)).toBe('dark-navy');
 }
});

it('gives the native window no fixed theme for system, so the frame follows the OS', () => {
 expect(nativeTheme('system')).toBeNull();
 expect(nativeTheme('light')).toBe('light');
 expect(nativeTheme('dark')).toBe('dark');
 expect(nativeTheme('dark-navy')).toBe('dark');
});

it('marks Dark Navy as a dark theme with the navy palette, and removes the palette for the others', () => {
 const root = { dataset: {} as Record<string, string | undefined>, style: {} as Record<string, string> } as unknown as HTMLElement;
 applyTheme('dark-navy', root);
 expect({ ...root.dataset, scheme: root.style.colorScheme }).toEqual({ theme: 'dark', palette: 'navy', scheme: 'dark' });
 applyTheme('dark', root);
 expect({ ...root.dataset, scheme: root.style.colorScheme }).toEqual({ theme: 'dark', scheme: 'dark' });
 applyTheme('light', root);
 expect({ ...root.dataset, scheme: root.style.colorScheme }).toEqual({ theme: 'light', scheme: 'light' });
});
