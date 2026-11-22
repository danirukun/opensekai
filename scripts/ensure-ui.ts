import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotUi } from './bootstrap-ui.ts';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

const EXPECTED_COMMIT_RE = /Expected source commit: ([0-9a-f]{40})/;
const COLOR_PICKER_EXPORT_RE = /export\s*\{[^}]*\bColorPicker\b/;

export const readExpectedUiCommit = (dependenciesMd: string): string => {
  const match = EXPECTED_COMMIT_RE.exec(dependenciesMd);
  if (!match) throw new Error('no expected UI kit commit in docs/dependencies.md');
  return match[1]!;
};

export type UiSnapshotMeta = { sha256: string; sourceCommit: string | null };

export const readUiSnapshot = async (snapshotPath: string): Promise<UiSnapshotMeta | null> => {
  try {
    return JSON.parse(await readFile(snapshotPath, 'utf8')) as UiSnapshotMeta;
  } catch {
    return null;
  }
};

export const uiDistExportsColorPicker = async (uiDir: string): Promise<boolean> => {
  try {
    const index = await readFile(join(uiDir, 'dist/index.js'), 'utf8');
    return COLOR_PICKER_EXPORT_RE.test(index);
  } catch {
    return false;
  }
};

export type EnsureUiResult =
  | { status: 'ok'; sourceCommit: string }
  | { status: 'refreshed'; sourceCommit: string; sourceDir: string }
  | { status: 'missing'; expected: string; observed: string | null; hint: string };

const resolveUiSource = async (candidates: string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'package.json'));
      await access(join(candidate, 'dist/index.js'));
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
};

const sourceCommitOf = async (sourceDir: string): Promise<string | null> => {
  try {
    return (await run('git', ['rev-parse', 'HEAD'], { cwd: sourceDir })).stdout.trim();
  } catch {
    return null;
  }
};

export const ensureUi = async (options: {
  rootDir: string;
  sourceCandidates?: string[];
  autoRefresh?: boolean;
}): Promise<EnsureUiResult> => {
  const rootDir = options.rootDir;
  const expected = readExpectedUiCommit(await readFile(join(rootDir, 'docs/dependencies.md'), 'utf8'));
  const snapshotPath = join(rootDir, '.local/ui-snapshot.json');
  const uiDir = join(rootDir, '.local/ui');
  const snapshot = await readUiSnapshot(snapshotPath);
  const hasColorPicker = await uiDistExportsColorPicker(uiDir);
  if (snapshot?.sourceCommit === expected && hasColorPicker) {
    return { status: 'ok', sourceCommit: expected };
  }

  const observed = snapshot?.sourceCommit ?? null;
  const hint =
    `UI kit snapshot is ${observed ?? 'missing'}, expected ${expected}` +
    `${hasColorPicker ? '' : ' (ColorPicker export missing)'}. ` +
    `Checkout that commit in oshi-connect-ui, run pnpm build there, then ` +
    `OPENSEKAI_UI_SOURCE=/path/to/oshi-connect-ui node scripts/bootstrap-ui.ts`;

  if (options.autoRefresh === false) {
    return { status: 'missing', expected, observed, hint };
  }

  const envSource = process.env.OPENSEKAI_UI_SOURCE;
  const candidates = [
    ...(envSource ? [resolve(envSource)] : []),
    ...(options.sourceCandidates ?? [resolve(rootDir, '../oshi-connect-ui')]),
  ];
  const sourceDir = await resolveUiSource(candidates);
  if (!sourceDir) {
    return { status: 'missing', expected, observed, hint };
  }

  const sourceCommit = await sourceCommitOf(sourceDir);
  if (sourceCommit !== null && sourceCommit !== expected) {
    return {
      status: 'missing',
      expected,
      observed,
      hint:
        `${hint}. Found UI source at ${sourceDir} on ${sourceCommit}; ` +
        `checkout ${expected} and rebuild before refresh.`,
    };
  }

  if (!(await uiDistExportsColorPicker(sourceDir))) {
    return {
      status: 'missing',
      expected,
      observed,
      hint: `${hint}. Found UI source at ${sourceDir}, but its dist does not export ColorPicker; run pnpm build there.`,
    };
  }

  const result = await snapshotUi(sourceDir, uiDir);
  await writeFile(snapshotPath, JSON.stringify(result, null, 2) + '\n');
  if (result.sourceCommit !== expected || !(await uiDistExportsColorPicker(uiDir))) {
    return {
      status: 'missing',
      expected,
      observed: result.sourceCommit,
      hint: `${hint}. Refresh from ${sourceDir} still did not match.`,
    };
  }
  return { status: 'refreshed', sourceCommit: expected, sourceDir };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await ensureUi({ rootDir: root });
  if (result.status === 'missing') {
    console.error(result.hint);
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}
