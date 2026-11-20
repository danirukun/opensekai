import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer as createVite, type ViteDevServer } from 'vite';

// A real Chromium page runs ColorField around the kit ColorPicker, with a stand-in host that applies each color 20 ms later.
// The pointer, key, and popover behavior of the kit needs a browser, so this is an integration test (B38 R11).

type Call = { kind: 'live' | 'end' | 'commit'; value?: string; at: number };

let browser: Browser;
let origin: string;
let http: Server;
let vite: ViteDevServer;
const pages: Page[] = [];

beforeAll(async () => {
 const desktop = fileURLToPath(new URL('..', import.meta.url));
 vite = await createVite({ root: desktop, base: '/', configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'mpa' });
 http = createServer((request, response) => { vite.middlewares(request, response, () => { response.statusCode = 404; response.end(); }); });
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

async function openPage() {
 const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 pages.push(page);
 await page.goto(`${origin}/test/color-field.harness.html`);
 try { await page.getByRole('button', { name: 'Color', exact: true }).waitFor({ timeout: 30000 }); }
 catch (error) { throw new Error(`${error instanceof Error ? error.message : error}\n${errors.join('\n')}`); }
 return page;
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);
const count = (list: Call[], kind: Call['kind']) => list.filter(call => call.kind === kind).length;
const hex = (page: Page) => page.getByRole('textbox', { name: 'Color', exact: true });
const shown = (page: Page) => hex(page).inputValue();
const scene = (page: Page) => page.getByTestId('scene').innerText();
const setHost = (page: Page, host: { apply?: boolean; reject?: boolean }) => page.evaluate(next => { Object.assign((window as unknown as { __host: object }).__host, next); }, host);

async function openPanel(page: Page) {
 await page.getByRole('button', { name: 'Color', exact: true }).click();
 const area = page.locator('div[role=slider]');
 await area.waitFor();
 const box = await area.boundingBox();
 if (!box) throw new Error('the area has no box');
 return { area, box };
}

async function drag(page: Page) {
 const { box } = await openPanel(page);
 await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
 await page.mouse.down();
 for (const [x, y] of [[0.5, 0.4], [0.7, 0.6], [0.8, 0.7]] as const) { await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 3 }); await page.waitForTimeout(40); }
 await page.mouse.up();
}

it('sends live colors for a pointer drag, then one end and no commit', async () => {
 const page = await openPage();
 await drag(page);
 await page.waitForTimeout(700);
 const list = await calls(page);
 expect(count(list, 'live')).toBeGreaterThanOrEqual(2);
 expect(count(list, 'end')).toBe(1);
 expect(count(list, 'commit')).toBe(0);
 expect(list.at(-1)?.kind).toBe('end');
 const last = list.filter(call => call.kind === 'live').at(-1)!.value!;
 expect(await shown(page)).toBe(last);
 expect(await scene(page)).toBe(last);
}, 60000);

it('shows the picked color for 500 ms after a drag when no scene update comes', async () => {
 const page = await openPage();
 await setHost(page, { apply: false });
 await drag(page);
 const picked = (await calls(page)).filter(call => call.kind === 'live').at(-1)!.value!;
 await page.waitForTimeout(150);
 expect(await shown(page)).toBe(picked);
 await page.waitForTimeout(700);
 expect(await shown(page)).toBe('#ff0000');
 expect(count(await calls(page), 'end')).toBe(1);
}, 60000);

it('ends the live edit once when a drag returns to its start color and the pointer is cancelled', async () => {
 const page = await openPage();
 const { area, box } = await openPanel(page);
 await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
 await page.mouse.down();
 await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 2 });
 await page.waitForTimeout(40);
 // Past the top right corner the area clamps to full saturation and value: the start color #ff0000.
 await page.mouse.move(box.x + box.width + 40, box.y - 40, { steps: 2 });
 await page.waitForTimeout(40);
 await area.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
 await page.waitForTimeout(700);
 const list = await calls(page);
 expect(list.filter(call => call.kind === 'live').at(-1)?.value).toBe('#ff0000');
 expect(count(list, 'end')).toBe(1);
 expect(count(list, 'commit')).toBe(0);
 await page.mouse.up();
 await page.waitForTimeout(100);
 expect(count(await calls(page), 'end')).toBe(1);
 // The field follows the scene again.
 await page.evaluate(() => (window as unknown as { __setValue: (next: string) => void }).__setValue('#00ff00'));
 await expect.poll(() => shown(page)).toBe('#00ff00');
}, 60000);

it('ends a Shift+Arrow key gesture once when Shift is released before the arrow', async () => {
 const page = await openPage();
 await openPanel(page);
 await page.keyboard.down('Shift');
 await page.keyboard.down('ArrowDown');
 await page.waitForTimeout(50);
 await page.keyboard.up('Shift');
 await page.waitForTimeout(50);
 await page.keyboard.up('ArrowDown');
 await page.waitForTimeout(700);
 const list = await calls(page);
 expect(count(list, 'live')).toBe(1);
 expect(count(list, 'end')).toBe(1);
 expect(count(list, 'commit')).toBe(0);
}, 60000);

it('commits a typed hex once, with no live color and no end', async () => {
 const page = await openPage();
 await hex(page).fill('#336699');
 await hex(page).press('Enter');
 await page.waitForTimeout(300);
 const list = await calls(page);
 expect(list.map(call => [call.kind, call.value])).toEqual([['commit', '#336699']]);
 expect(await scene(page)).toBe('#336699');
 expect(await shown(page)).toBe('#336699');
}, 60000);

it('shows the scene color again when the host does not take a typed hex', async () => {
 const page = await openPage();
 await setHost(page, { reject: true });
 await hex(page).fill('#336699');
 await hex(page).press('Enter');
 await page.waitForTimeout(1500);
 expect(count(await calls(page), 'commit')).toBe(1);
 expect(await scene(page)).toBe('#ff0000');
 expect(await shown(page)).toBe('#ff0000');
 expect(await page.getByRole('button', { name: 'Color', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 0, 0)');
}, 60000);
