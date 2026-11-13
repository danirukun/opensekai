import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { composite, contrastRatio, parseHex } from '../src/theme/contrast';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(root, 'src/app.css'), 'utf8');
const block = css.match(/:root \{[^}]+\}/)?.[0] ?? '';
const token = (name: string): string => {
  const value = block.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const BODY = 4.5;
const text = parseHex(token('--ds-color-text'));
const muted = parseHex(token('--ds-color-text-muted'));
const navy = parseHex(token('--ds-color-navy'));
const lime = parseHex(token('--ds-color-lime'));
const cyan = parseHex(token('--ds-color-cyan'));
const surfaces = {
  bg: parseHex(token('--ds-color-bg')),
  rail: parseHex(token('--ds-color-rail')),
  toolbar: parseHex(token('--ds-color-toolbar')),
  white: parseHex('#ffffff'),
};

const svelteFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? svelteFiles(path) : entry.name.endsWith('.svelte') ? [path] : [];
});

it('defines the brand colors and the neutral scale as tokens', () => {
  expect(token('--ds-color-lime')).toBe('#d1ffa5');
  expect(token('--ds-color-navy')).toBe('#00017f');
  expect(token('--ds-color-lilac')).toBe('#e7a0fe');
  expect(token('--ds-color-cyan')).toBe('#83e7ff');
  expect(token('--ds-color-bg')).toBe('#f5f5f8');
  expect(token('--ds-color-rail')).toBe('#f0f0f3');
  expect(token('--ds-color-toolbar')).toBe('#fafafd');
  expect(token('--ds-color-border')).toBe('#e3e1e9');
  expect(token('--ds-color-text')).toBe('#35333d');
  expect(token('--ds-color-text-muted')).toBe('#66636f');
  expect(token('--ds-color-selection')).toBe('color-mix(in srgb, var(--ds-color-cyan) 40%, transparent)');
  expect(token('--ds-color-on-selection')).toBe('var(--ds-color-navy)');
});

it('keeps lilac defined and unused', () => {
  expect(css.includes('var(--ds-color-lilac)')).toBe(false);
  for (const file of svelteFiles(join(root, 'src'))) expect(readFileSync(file, 'utf8').includes('lilac')).toBe(false);
});

it('keeps the brand and neutral hex values out of components', () => {
  const hexes = ['#d1ffa5', '#00017f', '#e7a0fe', '#83e7ff', '#f5f5f8', '#f0f0f3', '#fafafd', '#e3e1e9', '#35333d', '#66636f'];
  for (const file of svelteFiles(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8').toLowerCase();
    for (const hex of hexes) expect(source.includes(hex), `${file} ${hex}`).toBe(false);
  }
});

it('meets WCAG AA for body text on the neutral, lime, and selection surfaces', () => {
  for (const surface of Object.values(surfaces)) {
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(BODY);
    expect(contrastRatio(muted, surface)).toBeGreaterThanOrEqual(BODY);
  }
  expect(contrastRatio(text, lime)).toBeGreaterThanOrEqual(BODY);
  expect(contrastRatio(navy, lime)).toBeGreaterThanOrEqual(BODY);
  for (const surface of Object.values(surfaces)) {
    expect(contrastRatio(navy, composite(cyan, surface, 0.4))).toBeGreaterThanOrEqual(BODY);
  }
});

it('paints positive status with lime and primary text', () => {
  expect(css).toContain('.status-positive{background:var(--ds-color-lime);color:var(--ds-color-text)}');
});
