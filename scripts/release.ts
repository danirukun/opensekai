import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export type ReleaseVersion = {
  version: string;
  tag: string;
  title: string;
  bundleVersion: string;
  pubDate: string;
};

export type UpdaterManifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: { 'darwin-aarch64': { signature: string; url: string } };
};

export type DiscordMessage = {
  allowed_mentions: { parse: string[] };
  embeds: Array<{
    title: string;
    url: string;
    description?: string;
    color: number;
    fields: Array<{ name: string; value: string }>;
    timestamp: string;
  }>;
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const releaseVersion = (date: Date): ReleaseVersion => {
  if (Number.isNaN(date.getTime())) throw new Error('Release time is not a valid date');
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const version = `${year}.${month * 100 + day}.${hour * 100 + minute}`;
  return {
    version,
    tag: `v${version}`,
    title: `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)} UTC`,
    bundleVersion: `${year}${pad(month)}${pad(day)}${pad(hour)}${pad(minute)}`,
    pubDate: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
};

const versionParts = (value: string): [number, number, number] => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`Not a release version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const compareVersions = (a: string, b: string): number => {
  const left = versionParts(a);
  const right = versionParts(b);
  return left.map((part, index) => Math.sign(part - right[index])).find(sign => sign !== 0) ?? 0;
};

export const updaterManifest = (input: {
  version: string;
  notes: string;
  pubDate: string;
  signature: string;
  url: string;
}): UpdaterManifest => ({
  version: input.version,
  notes: input.notes.trim(),
  pub_date: input.pubDate,
  platforms: { 'darwin-aarch64': { signature: input.signature.trim(), url: input.url } },
});

export const DESCRIPTION_LIMIT = 4096;

// Discord counts the limit in UTF-16 units; cut on a code point so no surrogate pair splits.
export const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) return text;
  let kept = '';
  for (const char of text) {
    if (kept.length + char.length > limit - 1) break;
    kept += char;
  }
  return `${kept}…`;
};

export const discordMessage = (input: {
  version: string;
  releaseUrl: string;
  notes: string;
  downloadUrl: string;
  timestamp: string;
}): DiscordMessage => {
  const notes = input.notes.trim();
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `OpenSekai ${input.version}`,
        url: input.releaseUrl,
        ...(notes ? { description: truncate(notes, DESCRIPTION_LIMIT) } : {}),
        color: 0x7c5cff,
        fields: [{ name: 'macOS (Apple Silicon)', value: input.downloadUrl }],
        timestamp: input.timestamp,
      },
    ],
  };
};

const required = (values: Record<string, string | undefined>, name: string): string => {
  const value = values[name];
  if (value === undefined || value === '') throw new Error(`--${name} is required`);
  return value;
};

const run = async (argv: string[]): Promise<string> => {
  const [command, ...rest] = argv;
  if (command === 'version') {
    const [time] = rest;
    if (!time) throw new Error('Usage: release.ts version <commit time>');
    const result = releaseVersion(new Date(time));
    return [
      `version=${result.version}`,
      `tag=${result.tag}`,
      `title=${result.title}`,
      `bundle_version=${result.bundleVersion}`,
      `pub_date=${result.pubDate}`,
    ].join('\n');
  }
  if (command === 'newer') {
    const [candidate, latest = ''] = rest;
    if (!candidate) throw new Error('Usage: release.ts newer <version> [latest tag]');
    if (latest && compareVersions(candidate, latest) <= 0) {
      throw new Error(`Version ${candidate} is not newer than the latest release ${latest}`);
    }
    return `${candidate} is newer than ${latest || 'no release'}`;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      version: { type: 'string' },
      'pub-date': { type: 'string' },
      'notes-file': { type: 'string' },
      'signature-file': { type: 'string' },
      url: { type: 'string' },
      'release-url': { type: 'string' },
      'download-url': { type: 'string' },
    },
  });
  const notes = await readFile(required(values, 'notes-file'), 'utf8');
  if (command === 'manifest') {
    const manifest = updaterManifest({
      version: required(values, 'version'),
      notes,
      pubDate: required(values, 'pub-date'),
      signature: await readFile(required(values, 'signature-file'), 'utf8'),
      url: required(values, 'url'),
    });
    return JSON.stringify(manifest, null, 2);
  }
  if (command === 'discord') {
    const message = discordMessage({
      version: required(values, 'version'),
      releaseUrl: required(values, 'release-url'),
      notes,
      downloadUrl: required(values, 'download-url'),
      timestamp: required(values, 'pub-date'),
    });
    return JSON.stringify(message);
  }
  throw new Error(`Unknown command: ${command ?? '(none)'}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(await run(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
