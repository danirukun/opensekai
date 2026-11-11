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
  fitNotes,
  parseTags,
  planRelease,
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

test('plans the release against the existing tags', () => {
  const time = new Date('2026-11-10T23:18:42Z');
  expect(planRelease(time, 'c3', []).version).toBe('2026.1110.2318');
  expect(planRelease(time, 'c3', [{ name: 'nightly', sha: 'c0' }]).version).toBe('2026.1110.2318');
  expect(planRelease(time, 'c3', [{ name: 'v2026.1110.2317', sha: 'c2' }]).version).toBe('2026.1110.2318');
  expect(() => planRelease(time, 'c3', [{ name: 'v2026.1110.2319', sha: 'c4' }])).toThrow(
    'older than the latest release v2026.1110.2319',
  );
  expect(() => planRelease(time, 'c2', [{ name: 'v2026.1110.2317', sha: 'c2' }])).toThrow(
    'already released as v2026.1110.2317',
  );
});

test('moves a merge in the same UTC minute to the next minute', () => {
  const time = new Date('2026-11-10T23:59:42Z');
  const first = planRelease(time, 'c3', [{ name: 'v2026.1110.2359', sha: 'c2' }]);
  expect(first).toEqual({
    version: '2026.1110.2360',
    tag: 'v2026.1110.2360',
    title: '2026-11-10 23:59 UTC',
    bundleVersion: '202611102360',
    pubDate: '2026-11-10T23:59:42Z',
  });
  const second = planRelease(time, 'c4', [
    { name: 'v2026.1110.2359', sha: 'c2' },
    { name: 'v2026.1110.2360', sha: 'c3' },
  ]);
  expect(second.version).toBe('2026.1110.2361');
  expect(compareVersions(releaseVersion(new Date('2026-11-11T00:00:00Z')).version, second.version)).toBe(1);
});

test('stops a rerun of an older commit from the same minute as an earlier release', () => {
  const tags = [
    { name: 'v2026.1110.2318', sha: 'a' },
    { name: 'v2026.1110.2330', sha: 'c' },
  ];
  expect(() => planRelease(new Date('2026-11-10T23:18:30Z'), 'b', tags)).toThrow(
    'Version 2026.1110.2319 is older than the latest release v2026.1110.2330',
  );
});

test('reads the tag list that the workflow writes', () => {
  expect(parseTags('v2026.1110.2318 abc\n\nnightly def\n')).toEqual([
    { name: 'v2026.1110.2318', sha: 'abc' },
    { name: 'nightly', sha: 'def' },
  ]);
});

test('drops the oldest changes first when the notes are too long', () => {
  const items = Array.from({ length: 60 }, (_, index) => `* Change ${index + 1} by @someone in #${index + 1}`);
  const notes = ["## What's Changed", ...items, '', '## New Contributors', '* @someone made a first contribution', '', '**Full Changelog**: v1...v2'].join('\n');
  const fitted = fitNotes(notes, 1000);
  expect(fitted.length).toBeLessThanOrEqual(1000);
  expect(fitted.startsWith("## What's Changed\n* …and ")).toBe(true);
  expect(fitted).toContain('* Change 60 by');
  expect(fitted).not.toContain('* Change 1 by');
  expect(fitted.endsWith('**Full Changelog**: v1...v2')).toBe(true);
  expect(fitted).toContain('* @someone made a first contribution');
  expect(fitNotes('short', 1000)).toBe('short');
  expect(fitNotes('x'.repeat(2000), 1000)).toHaveLength(1000);
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
  const longList = Array.from({ length: 200 }, (_, index) => `* Change ${index + 1} by @someone in #${index + 1}`).join('\n');
  const description = discordMessage({ ...input, notes: longList }).embeds[0].description ?? '';
  expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  expect(description).toContain('* Change 200 by');
});

test('the command line writes the outputs that the workflow reads', async () => {
  const run = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), 'opensekai-release-'));
  temporary.push(directory);
  const notes = join(directory, 'notes.md');
  const signature = join(directory, 'app.tar.gz.sig');
  await writeFile(notes, '* Change\n');
  await writeFile(signature, 'c2ln\n');

  const version = await run(process.execPath, [script, 'version', '--time', '2026-11-10T23:18:42Z']);
  expect(version.stdout.trim().split('\n')).toEqual([
    'version=2026.1110.2318',
    'tag=v2026.1110.2318',
    'title=2026-11-10 23:18 UTC',
    'bundle_version=202611102318',
    'pub_date=2026-11-10T23:18:42Z',
  ]);
  const tags = join(directory, 'tags.txt');
  await writeFile(tags, 'v2026.1110.2318 c2\nnightly c0\n');
  const planned = await run(process.execPath, [
    script, 'version', '--time', '2026-11-10T23:18:59Z', '--sha', 'c3', '--tags-file', tags,
  ]);
  expect(planned.stdout).toContain('version=2026.1110.2319\n');
  await expect(
    run(process.execPath, [script, 'version', '--time', '2026-11-10T23:18:59Z', '--sha', 'c2', '--tags-file', tags]),
  ).rejects.toThrow('already released');

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
});
