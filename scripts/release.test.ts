import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import {
  DESCRIPTION_LIMIT,
  compareVersions,
  discordMessage,
  releaseVersion,
  truncate,
  updaterManifest,
} from './release.ts';

const script = fileURLToPath(new URL('./release.ts', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true })));
  temporary.length = 0;
});

test('makes the version from the UTC commit time without leading zeros', () => {
  expect(releaseVersion(new Date('2026-11-10T23:18:42Z'))).toEqual({
    version: '2026.1110.2318',
    tag: 'v2026.1110.2318',
    title: '2026-11-10 23:18 UTC',
    bundleVersion: '202611102318',
    pubDate: '2026-11-10T23:18:42Z',
  });
  expect(releaseVersion(new Date('2027-01-05T09:04:00Z')).version).toBe('2027.105.904');
  expect(releaseVersion(new Date('2027-01-01T00:00:00Z')).version).toBe('2027.101.0');
  expect(releaseVersion(new Date('2026-11-11T01:30:00+02:00')).version).toBe('2026.1110.2330');
});

test('rejects a time that is not a date', () => {
  expect(() => releaseVersion(new Date('not a date'))).toThrow('not a valid date');
});

test('orders versions by number, across days, months, and years', () => {
  const times = [
    '2026-11-10T23:59:00Z',
    '2026-11-11T00:00:00Z',
    '2026-11-30T12:00:00Z',
    '2026-12-01T00:00:00Z',
    '2027-01-01T00:00:00Z',
    '2027-01-09T23:59:00Z',
    '2027-01-10T00:00:00Z',
  ].map(time => releaseVersion(new Date(time)).version);
  for (let index = 1; index < times.length; index += 1) {
    expect(compareVersions(times[index], times[index - 1])).toBe(1);
    expect(compareVersions(times[index - 1], times[index])).toBe(-1);
  }
  expect(compareVersions('v2026.1110.2318', '2026.1110.2318')).toBe(0);
  expect(() => compareVersions('2026.1110', '2026.1110.1')).toThrow('Not a release version');
});

test('writes the Tauri static updater manifest', () => {
  expect(
    updaterManifest({
      version: '2026.1110.2318',
      notes: '\n## What changed\n* A\n',
      pubDate: '2026-11-10T23:18:42Z',
      signature: 'c2lnbmF0dXJl\n',
      url: 'https://example.test/OpenSekai.app.tar.gz',
    }),
  ).toEqual({
    version: '2026.1110.2318',
    notes: '## What changed\n* A',
    pub_date: '2026-11-10T23:18:42Z',
    platforms: {
      'darwin-aarch64': { signature: 'c2lnbmF0dXJl', url: 'https://example.test/OpenSekai.app.tar.gz' },
    },
  });
});

test('keeps the Discord description in the limit without splitting a character', () => {
  const long = '😀'.repeat(DESCRIPTION_LIMIT);
  const cut = truncate(long, DESCRIPTION_LIMIT);
  expect(cut.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  expect(cut.endsWith('😀…')).toBe(true);
  expect(truncate('short', DESCRIPTION_LIMIT)).toBe('short');
});

test('makes one Discord embed that mentions nobody', () => {
  const input = {
    version: '2026.1110.2318',
    releaseUrl: 'https://github.com/danirukun/opensekai/releases/tag/v2026.1110.2318',
    notes: '* Fix by @someone in #283',
    downloadUrl: 'https://github.com/danirukun/opensekai/releases/download/v2026.1110.2318/a.zip',
    timestamp: '2026-11-10T23:18:42Z',
  };
  const message = discordMessage(input);
  expect(message.allowed_mentions).toEqual({ parse: [] });
  expect(message.embeds).toHaveLength(1);
  expect(message.embeds[0]).toMatchObject({
    title: 'OpenSekai 2026.1110.2318',
    url: input.releaseUrl,
    description: input.notes,
    fields: [{ name: 'macOS (Apple Silicon)', value: input.downloadUrl }],
    timestamp: input.timestamp,
  });
  expect(discordMessage({ ...input, notes: '  \n' }).embeds[0]).not.toHaveProperty('description');
  expect(discordMessage({ ...input, notes: 'x'.repeat(5000) }).embeds[0].description).toHaveLength(DESCRIPTION_LIMIT);
});

test('the command line writes the outputs that the workflow reads', async () => {
  const run = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'opensekai-release-'));
  temporary.push(directory);
  const notes = join(directory, 'notes.md');
  const signature = join(directory, 'app.tar.gz.sig');
  await writeFile(notes, '* Change\n');
  await writeFile(signature, 'c2ln\n');

  const version = await run(process.execPath, [script, 'version', '2026-11-10T23:18:42Z']);
  expect(version.stdout.trim().split('\n')).toEqual([
    'version=2026.1110.2318',
    'tag=v2026.1110.2318',
    'title=2026-11-10 23:18 UTC',
    'bundle_version=202611102318',
    'pub_date=2026-11-10T23:18:42Z',
  ]);

  const manifest = await run(process.execPath, [
    script, 'manifest', '--version', '2026.1110.2318', '--pub-date', '2026-11-10T23:18:42Z',
    '--notes-file', notes, '--signature-file', signature, '--url', 'https://example.test/a.tar.gz',
  ]);
  expect(JSON.parse(manifest.stdout).platforms['darwin-aarch64']).toEqual({
    signature: 'c2ln',
    url: 'https://example.test/a.tar.gz',
  });

  const discord = await run(process.execPath, [
    script, 'discord', '--version', '2026.1110.2318', '--pub-date', '2026-11-10T23:18:42Z',
    '--notes-file', notes, '--release-url', 'https://example.test/r', '--download-url', 'https://example.test/a.zip',
  ]);
  expect(discord.stdout.trim().split('\n')).toHaveLength(1);
  expect(JSON.parse(discord.stdout).embeds[0].description).toBe('* Change');

  await expect(run(process.execPath, [script, 'newer', '2026.1110.2318', 'v2026.1110.2318'])).rejects.toThrow(
    'is not newer',
  );
  await expect(run(process.execPath, [script, 'newer', '2026.1110.2319', 'v2026.1110.2318'])).resolves.toBeTruthy();
  await expect(run(process.execPath, [script, 'newer', '2026.1110.2318', ''])).resolves.toBeTruthy();
});
