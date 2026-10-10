import { expect, it } from 'vitest';
import { shortcutFor } from '../src/blueprints/keys';

const mac = 'MacIntel', win = 'Win32';
const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: unknown = { tagName: 'DIV' }) =>
 ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods, target: target as EventTarget });

it('maps the canvas shortcuts for each platform', () => {
 expect(shortcutFor(press('Backspace'), mac)).toBe('delete');
 expect(shortcutFor(press('Delete'), win)).toBe('delete');
 expect(shortcutFor(press('Escape'), mac)).toBe('escape');
 expect(shortcutFor(press('c', { metaKey: true }), mac)).toBe('copy');
 expect(shortcutFor(press('v', { metaKey: true }), mac)).toBe('paste');
 expect(shortcutFor(press('d', { metaKey: true }), mac)).toBe('duplicate');
 expect(shortcutFor(press('a', { metaKey: true }), mac)).toBe('selectAll');
 expect(shortcutFor(press('z', { metaKey: true }), mac)).toBe('undo');
 expect(shortcutFor(press('Z', { metaKey: true, shiftKey: true }), mac)).toBe('redo');
 expect(shortcutFor(press('c', { ctrlKey: true }), win)).toBe('copy');
 expect(shortcutFor(press('c', { ctrlKey: true }), mac)).toBeNull();
 expect(shortcutFor(press('c', { metaKey: true }), win)).toBeNull();
 expect(shortcutFor(press('c', { metaKey: true, altKey: true }), mac)).toBeNull();
 expect(shortcutFor(press('x'), mac)).toBeNull();
});

it('never fires while a text field, select, or editable element has focus', () => {
 for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
  expect(shortcutFor(press('Backspace', {}, target), mac)).toBeNull();
  expect(shortcutFor(press('z', { metaKey: true }, target), mac)).toBeNull();
 }
});
