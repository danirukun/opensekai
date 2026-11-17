import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer as createVite, type ViteDevServer } from 'vite';

// A real Chromium page runs the asset list and the context menu.
// The menu close used to move focus and dismiss the rename field.

type RenameCall = { id: string; name: string; revision: number };
type PageState = { menu: number; input: boolean; focused: boolean; calls: RenameCall[] };

let browser: Browser;
let origin: string;
let http: Server;
let vite: ViteDevServer;
const pages: Page[] = [];

function readState(): PageState {
  const input = document.querySelector('.asset-rename input');
  const calls = (window as unknown as { __renames?: RenameCall[] }).__renames ?? [];
  return { menu: document.querySelectorAll('.context-menu').length, input: !!input, focused: !!input && document.activeElement === input, calls };
}

async function poll(page: Page, ready: (state: PageState) => boolean, label: string): Promise<PageState> {
  const start = Date.now();
  let state = await page.evaluate(readState);
  while (!ready(state)) {
    if (Date.now() - start > 2000) throw new Error(`${label}. Last state: ${JSON.stringify(state)}`);
    await new Promise(resolve => setTimeout(resolve, 16));
    state = await page.evaluate(readState);
  }
  return state;
}

async function openRename(page: Page): Promise<PageState> {
  // A right-click on macOS does not focus the row. Focus stays on another control.
  await page.evaluate(() => {
    const search = document.querySelector('.asset-search input');
    if (search instanceof HTMLInputElement) search.focus();
    document.querySelector('.entity-list')?.addEventListener('mousedown', event => { if (event.button !== 0) event.preventDefault(); }, true);
  });
  await page.getByRole('button', { name: 'marker', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await poll(page, state => state.menu === 0, 'context menu did not close');
  // The menu removal can blur the field on the next frame. Read the field after that frame.
  await page.evaluate(() => new Promise<void>(resolve => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
  return page.evaluate(readState);
}

beforeAll(async () => {
  const desktop = fileURLToPath(new URL('..', import.meta.url));
  vite = await createVite({
    root: desktop,
    base: '/',
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'mpa',
  });
  http = createServer((request, response) => {
    vite.middlewares(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
  await Promise.all(pages.map(page => page.close()));
  await browser?.close();
  if (http) await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  await vite?.close();
});

async function openPage(reducedMotion: 'no-preference' | 'reduce') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  pages.push(page);
  const response = await page.goto(`${origin}/test/asset-rename.harness.html`);
  if (!response?.ok()) errors.push(`document status ${response?.status() ?? 'none'}`);
  try {
    await page.getByRole('button', { name: 'marker', exact: true }).waitFor({ timeout: 30000 });
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(`${error instanceof Error ? error.message : error}\n${errors.join('\n')}\n${body.slice(0, 2000)}`);
  }
  return page;
}

it('keeps the asset rename field open after the context menu closes', async () => {
  const page = await openPage('no-preference');
  const state = await openRename(page);
  expect(state.input).toBe(true);
  expect(state.focused).toBe(true);
  expect(state.calls).toEqual([]);
  await page.locator('.asset-rename input').fill('Renamed marker');
  await page.locator('.asset-rename input').press('Enter');
  const committed = await poll(page, next => next.calls.length === 1 && !next.input, 'Enter did not commit');
  expect(committed.calls).toEqual([{ id: 'marker', name: 'Renamed marker', revision: 0 }]);
}, 60000);

it('cancels a typed asset rename on Escape', async () => {
  const page = await openPage('no-preference');
  await openRename(page);
  await page.locator('.asset-rename input').fill('Temporary');
  await page.locator('.asset-rename input').press('Escape');
  const state = await poll(page, next => !next.input, 'Escape did not close the field');
  expect(state.calls).toEqual([]);
}, 60000);

it('commits a typed asset rename on a pointer press outside the field', async () => {
  const page = await openPage('no-preference');
  await openRename(page);
  await page.locator('.asset-rename input').fill('Clicked name');
  await page.getByRole('heading', { name: 'Assets' }).click();
  const state = await poll(page, next => next.calls.length === 1 && !next.input, 'click outside did not commit');
  expect(state.calls).toEqual([{ id: 'marker', name: 'Clicked name', revision: 0 }]);
}, 60000);

it('keeps the rename field open when the context menu closes with reduced motion', async () => {
  const page = await openPage('reduce');
  const state = await openRename(page);
  expect(state.input).toBe(true);
  expect(state.focused).toBe(true);
  expect(state.calls).toEqual([]);
}, 60000);
