import { expect, it } from 'vitest';
import { toolForKey } from '../src/editor/scene-keys';

const ready = { assetsShown: true, editable: true };
const press = (key: string, extra: Partial<{ modifier: boolean; editableTarget: boolean }> = {}) => ({ key, modifier: false, editableTarget: false, ...extra });

it('maps W, E, and R to Move, Rotate, and Scale on the Assets tab', () => {
 expect(toolForKey(press('w'), ready)).toBe('translate');
 expect(toolForKey(press('e'), ready)).toBe('rotate');
 expect(toolForKey(press('r'), ready)).toBe('scale');
 expect(toolForKey(press('W'), ready)).toBe('translate');
});
it('ignores a modifier, a text target, another tab, a read-only session, and other keys', () => {
 expect(toolForKey(press('w', { modifier: true }), ready)).toBeNull();
 expect(toolForKey(press('w', { editableTarget: true }), ready)).toBeNull();
 expect(toolForKey(press('w'), { assetsShown: false, editable: true })).toBeNull();
 expect(toolForKey(press('w'), { assetsShown: true, editable: false })).toBeNull();
 expect(toolForKey(press('q'), ready)).toBeNull();
 expect(toolForKey(press('Escape'), ready)).toBeNull();
});
