import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

export async function snapshotUi(
  sourceDir: string,
  targetDir: string,
): Promise<{ sha256: string; sourceCommit: string | null }> {
  const pkg = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf8'));
  delete pkg.scripts;
  await readdir(join(sourceDir, 'dist'));
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(join(sourceDir, 'dist'), join(targetDir, 'dist'), { recursive: true });
  await writeFile(join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  const dist = join(targetDir, 'dist');
  const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash('sha256').update(JSON.stringify(pkg));
  for (const file of files) {
    hash.update(relative(dist, file).replaceAll('\\', '/'));
    hash.update(await readFile(file));
  }

  let sourceCommit: string | null = null;
  try {
    await run('pwd', [], { cwd: sourceDir });
    sourceCommit = (await run('git', ['rev-parse', 'HEAD'], { cwd: sourceDir })).stdout.trim();
  } catch {
    // A fixture or published package can have no Git metadata.
  }
  return { sha256: hash.digest('hex'), sourceCommit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    throw new Error('The snapshot destination is fixed to this checkout');
  }
  const source = process.env.OPENSEKAI_UI_SOURCE;
  if (!source) throw new Error('OPENSEKAI_UI_SOURCE is required');
  const result = await snapshotUi(resolve(source), join(root, '.local/ui'));
  await writeFile(join(root, '.local/ui-snapshot.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
