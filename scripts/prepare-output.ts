import { access, cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function prepareOutput(sourceDir: string, targetDir: string): Promise<void> {
 await access(join(sourceDir, 'index.html'));
 await rm(targetDir, { recursive: true, force: true });
 await mkdir(targetDir, { recursive: true });
 await cp(sourceDir, targetDir, { recursive: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 if (process.argv.length > 2) throw new Error('The output destination is fixed to this checkout');
 await prepareOutput(join(root, 'apps/output/dist'), join(root, 'apps/desktop/src-tauri/resources/output'));
}
