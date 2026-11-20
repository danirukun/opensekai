export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_KEY = 'opensekai.theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const parseTheme = (raw: string | null): ThemePreference =>
 raw === 'light' || raw === 'dark' ? raw : 'system';

export const resolveTheme = (pref: ThemePreference, systemDark: boolean): ResolvedTheme =>
 pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

// Tauri takes null as "follow the OS".
export const nativeTheme = (pref: ThemePreference): ResolvedTheme | null =>
 pref === 'system' ? null : pref;

export const applyTheme = (resolved: ResolvedTheme, root: HTMLElement = document.documentElement): void => {
 root.dataset.theme = resolved;
 root.style.colorScheme = resolved;
};
