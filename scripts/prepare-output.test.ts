import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareOutput } from './prepare-output.ts';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true }))); temporary.length = 0; });
test('copies built output and clears stale release files', async () => {
 const root = await mkdtemp(join(tmpdir(), 'opensekai-output-')); temporary.push(root);
 const source = join(root, 'source'), target = join(root, 'target');
 await mkdir(source); await mkdir(target); await writeFile(join(source, 'index.html'), '<canvas></canvas>'); await writeFile(join(source, 'main.js'), 'export {};'); await writeFile(join(target, 'stale.js'), 'old');
 await prepareOutput(source, target);
 expect((await readdir(target)).sort()).toEqual(['index.html', 'main.js']); expect(await readFile(join(target, 'index.html'), 'utf8')).toBe('<canvas></canvas>');
});
test('rejects a missing entry before removing the previous output', async () => {
 const root = await mkdtemp(join(tmpdir(), 'opensekai-output-')); temporary.push(root);
 const target = join(root, 'target'); await mkdir(target); await writeFile(join(target, 'index.html'), 'previous');
 await expect(prepareOutput(join(root, 'missing'), target)).rejects.toThrow();
 expect(await readFile(join(target, 'index.html'), 'utf8')).toBe('previous');
});
