import type { KeystrokeSettings } from '@opensekai/contracts';

export const isMac = (platform: string) => /Mac|iPhone|iPad/.test(platform);
export const currentPlatform = (): string => (typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent);
export const defaultKeystroke = (platform: string): KeystrokeSettings =>
 isMac(platform) ? { code: 'KeyH', control: true, alt: true, shift: false, meta: false } : { code: 'KeyH', control: true, alt: false, shift: true, meta: false };
const key = (code: string) => code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ').replace(/^Arrow/, '');
export function formatKeystroke(s: KeystrokeSettings, platform: string): string {
 if (isMac(platform)) return `${s.control ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.meta ? '⌘' : ''}${key(s.code)}`;
 return [s.control && 'Ctrl', s.alt && 'Alt', s.shift && 'Shift', s.meta && 'Win', key(s.code)].filter(Boolean).join('+');
}
