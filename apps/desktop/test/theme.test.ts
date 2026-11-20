import { expect, it } from 'vitest';
import { nativeTheme, parseTheme, resolveTheme } from '../src/editor/theme';

it('reads a stored preference and falls back to system for missing or unknown text', () => {
 expect(parseTheme('system')).toBe('system');
 expect(parseTheme('light')).toBe('light');
 expect(parseTheme('dark')).toBe('dark');
 expect(parseTheme(null)).toBe('system');
 expect(parseTheme('x')).toBe('system');
});

it('follows the OS only for the system preference', () => {
 expect(resolveTheme('system', true)).toBe('dark');
 expect(resolveTheme('system', false)).toBe('light');
 expect(resolveTheme('light', true)).toBe('light');
 expect(resolveTheme('light', false)).toBe('light');
 expect(resolveTheme('dark', true)).toBe('dark');
 expect(resolveTheme('dark', false)).toBe('dark');
});

it('gives the native window no fixed theme for system, so the frame follows the OS', () => {
 expect(nativeTheme('system')).toBeNull();
 expect(nativeTheme('light')).toBe('light');
 expect(nativeTheme('dark')).toBe('dark');
});
