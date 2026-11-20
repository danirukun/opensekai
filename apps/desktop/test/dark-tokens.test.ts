import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { composite, contrastRatio, parseHex, type Rgb } from '../src/theme/contrast';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = readFileSync(join(root, 'src/app.css'), 'utf8');
const declarations = (block: string): Map<string, string> => new Map(
 [...block.matchAll(/(--ds-color-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);
const light = declarations(css.match(/:root \{[^}]+\}/)?.[0] ?? '');
const dark = declarations(css.match(/html\[data-theme='dark'\]\s*\{[^}]+\}/)?.[0] ?? '');
// The brand colors are the same in both themes.
const BRAND = new Set(['--ds-color-lime', '--ds-color-navy', '--ds-color-lilac', '--ds-color-cyan']);

const darkValue = (name: string): string => {
 const value = dark.get(name) ?? light.get(name);
 if (!value) throw new Error(`missing ${name}`);
 const ref = value.match(/^var\((--ds-color-[\w-]+)\)$/);
 return ref ? darkValue(ref[1]) : value;
};
const color = (name: string): Rgb => parseHex(darkValue(name));
const selection = (): { tint: Rgb; alpha: number } => {
 const mix = darkValue('--ds-color-selection').match(/^color-mix\(in srgb, var\((--ds-color-[\w-]+)\) (\d+)%, transparent\)$/);
 if (!mix) throw new Error('selection is not a color-mix of one token');
 return { tint: color(mix[1]), alpha: Number(mix[2]) / 100 };
};

const BODY = 4.5;
const SURFACES = ['bg', 'rail', 'toolbar', 'panel', 'surface', 'surface-elevated'].map(name => `--ds-color-${name}`);

it('gives each app color token a dark value', () => {
 expect(dark.size).toBeGreaterThan(0);
 for (const name of light.keys()) if (!BRAND.has(name)) expect(dark.has(name), name).toBe(true);
});

it('meets WCAG AA for text and muted text on each dark surface', () => {
 for (const surface of SURFACES) {
  expect(contrastRatio(color('--ds-color-text'), color(surface)), surface).toBeGreaterThanOrEqual(BODY);
  expect(contrastRatio(color('--ds-color-text-muted'), color(surface)), surface).toBeGreaterThanOrEqual(BODY);
 }
});

it('meets WCAG AA for text on the dark selection over each surface', () => {
 const { tint, alpha } = selection();
 for (const surface of SURFACES) {
  expect(contrastRatio(color('--ds-color-on-selection'), composite(tint, color(surface), alpha)), surface).toBeGreaterThanOrEqual(BODY);
 }
});

it('meets WCAG AA for primary, lime, error, warning, link, and debug text in dark', () => {
 expect(contrastRatio(color('--ds-color-on-primary'), color('--ds-color-primary'))).toBeGreaterThanOrEqual(BODY);
 expect(contrastRatio(color('--ds-color-on-lime'), color('--ds-color-lime'))).toBeGreaterThanOrEqual(BODY);
 expect(contrastRatio(color('--ds-color-error'), color('--ds-color-surface'))).toBeGreaterThanOrEqual(BODY);
 expect(contrastRatio(color('--ds-color-warning-text'), color('--ds-color-warning-bg'))).toBeGreaterThanOrEqual(BODY);
 expect(contrastRatio(color('--ds-color-link'), color('--ds-color-panel'))).toBeGreaterThanOrEqual(BODY);
 for (const name of ['--ds-color-debug-warning', '--ds-color-debug-error']) {
  expect(contrastRatio(color(name), color('--ds-color-toolbar')), name).toBeGreaterThanOrEqual(BODY);
 }
 for (const surface of ['--ds-color-surface', '--ds-color-panel']) {
  expect(contrastRatio(color('--ds-color-hidden-text'), color(surface)), surface).toBeGreaterThanOrEqual(BODY);
 }
});

it('keeps a dark focus ring at 3:1 on the surface', () => {
 expect(contrastRatio(color('--ds-color-focus'), color('--ds-color-surface'))).toBeGreaterThanOrEqual(3);
});

const svelteFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
 const path = join(dir, entry.name);
 return entry.isDirectory() ? svelteFiles(path) : entry.name.endsWith('.svelte') ? [path] : [];
});
// The coach face is an illustration and the guide lines draw over video, so both keep fixed colors.
const FIXED = new Set(['CoachFace.svelte', 'GuideOverlay.svelte']);

it('keeps hex color literals out of components, so both themes reach every surface', () => {
 for (const file of svelteFiles(join(root, 'src'))) {
  if (FIXED.has(basename(file))) continue;
  expect(readFileSync(file, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull();
 }
});

it('keeps hex color literals in app.css to the token blocks, the Blueprint category and socket colors, and #0000', () => {
 const rules = css.replace(/:root \{[^}]+\}/, '').replace(/html\[data-theme='dark'\]\s*\{[^}]+\}/, '');
 const literals = [...rules.matchAll(/[^;{}]*#[0-9a-fA-F]{3,8}\b[^;{}]*/g)].map(([declaration]) => declaration.trim())
  .filter(declaration => !/^--bp-(category|socket)\s*:/.test(declaration) && !/var\(--bp-(category|socket),#[0-9a-fA-F]+\)/.test(declaration))
  .filter(declaration => declaration.replace(/#0000\b/g, '').match(/#[0-9a-fA-F]{3,8}\b/) !== null);
 expect(literals).toEqual([]);
});
