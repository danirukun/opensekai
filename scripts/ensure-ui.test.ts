import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureUi,
  readExpectedUiCommit,
  uiDistExportsColorPicker,
} from './ensure-ui.ts';

const run = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true })));
  temporary.length = 0;
});

test('readExpectedUiCommit reads the pin from dependencies.md', () => {
  const pin = '348be1eb986ac3f371c425514bb66ef9022f78a8';
  expect(readExpectedUiCommit(`Expected source commit: ${pin} (kit 0.2.0)`)).toBe(pin);
  expect(() => readExpectedUiCommit('no pin here')).toThrow(/expected UI kit commit/);
});

test('ensureUi refreshes a stale snapshot from a matching kit source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opensekai-ensure-ui-'));
  temporary.push(root);
  const source = join(root, 'oshi-connect-ui');
  await mkdir(join(source, 'dist'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, '.local/ui/dist'), { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@oshi-connect/ui', version: '0.2.0' }));
  await writeFile(
    join(source, 'dist/index.js'),
    "export { default as ColorPicker } from './components/ColorPicker.svelte';\n",
  );
  await run('git', ['init'], { cwd: source });
  await run('git', ['add', 'package.json', 'dist'], { cwd: source });
  await run('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'pin'], {
    cwd: source,
  });
  const expected = (await run('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  await writeFile(
    join(root, 'docs/dependencies.md'),
    `Expected source commit: ${expected} (kit 0.2.0, with ColorPicker).\n`,
  );
  await writeFile(
    join(root, '.local/ui-snapshot.json'),
    JSON.stringify({ sha256: 'a'.repeat(64), sourceCommit: '25d5144d2ffaeed84d596c482a0e5424c1d9ea9e' }) + '\n',
  );
  await writeFile(join(root, '.local/ui/dist/index.js'), 'export { default as Button } from "./Button.svelte";\n');

  const result = await ensureUi({ rootDir: root, sourceCandidates: [source] });
  expect(result).toEqual({ status: 'refreshed', sourceCommit: expected, sourceDir: source });
  expect(await uiDistExportsColorPicker(join(root, '.local/ui'))).toBe(true);
});

test('ensureUi fails when no source can supply the pin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opensekai-ensure-ui-'));
  temporary.push(root);
  const pin = '348be1eb986ac3f371c425514bb66ef9022f78a8';
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs/dependencies.md'), `Expected source commit: ${pin} (kit 0.2.0).\n`);
  const result = await ensureUi({ rootDir: root, sourceCandidates: [] });
  expect(result.status).toBe('missing');
  if (result.status === 'missing') {
    expect(result.expected).toBe(pin);
    expect(result.hint).toMatch(/bootstrap-ui/);
  }
});
