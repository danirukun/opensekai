import { expect, it } from 'vitest';
import { searchEscape } from '../src/editor/search-field';

it('clears a search field on Escape when it has text', () => {
  expect(searchEscape('camera', 'Escape')).toBe('clear');
  expect(searchEscape(' ', 'Escape')).toBe('clear');
});

it('blurs a search field on Escape when it is empty', () => {
  expect(searchEscape('', 'Escape')).toBe('blur');
});

it('leaves other keys to the caller', () => {
  expect(searchEscape('camera', 'Enter')).toBe('ignore');
  expect(searchEscape('', 'ArrowDown')).toBe('ignore');
});
