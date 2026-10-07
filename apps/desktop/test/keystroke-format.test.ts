import { expect, it } from 'vitest';
import { defaultKeystroke, formatKeystroke } from '../src/blueprints/keystroke-format';

it('uses idiomatic platform defaults and labels', () => {
 expect(defaultKeystroke('MacIntel')).toEqual({ code: 'KeyH', control: true, alt: true, shift: false, meta: false });
 expect(defaultKeystroke('Win32')).toEqual({ code: 'KeyH', control: true, alt: false, shift: true, meta: false });
 expect(formatKeystroke({ code: 'KeyH', control: true, alt: true, shift: true, meta: true }, 'MacIntel')).toBe('⌃⌥⇧⌘H');
 expect(formatKeystroke({ code: 'Digit1', control: true, alt: false, shift: true, meta: false }, 'Win32')).toBe('Ctrl+Shift+1');
 expect(formatKeystroke({ code: 'F5', control: false, alt: true, shift: false, meta: true }, 'Win32')).toBe('Alt+Win+F5');
});
