export type ThemePreference = 'system' | 'light' | 'dark' | 'dark-navy';
export type ResolvedTheme = 'light' | 'dark' | 'dark-navy';

export const THEME_KEY = 'opensekai.theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark', 'dark-navy'];

export const parseTheme = (raw: string | null): ThemePreference =>
 raw === 'light' || raw === 'dark' || raw === 'dark-navy' ? raw : 'system';

// System gives Light or Dark, never Dark Navy.
export const resolveTheme = (pref: ThemePreference, systemDark: boolean): ResolvedTheme =>
 pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

// Tauri takes null as "follow the OS". Dark Navy has a dark frame.
export const nativeTheme = (pref: ThemePreference): 'light' | 'dark' | null =>
 pref === 'system' ? null : pref === 'light' ? 'light' : 'dark';

// Dark Navy is the dark theme with the navy palette, so the kit dark set and its dark variant apply to it too.
export const applyTheme = (resolved: ResolvedTheme, root: HTMLElement = document.documentElement): void => {
 const scheme = resolved === 'light' ? 'light' : 'dark';
 root.dataset.theme = scheme;
 if (resolved === 'dark-navy') root.dataset.palette = 'navy';
 else delete root.dataset.palette;
 root.style.colorScheme = scheme;
};
