import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({ test: { root, passWithNoTests: true, projects: [
 { test: { name: 'unit', root, include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'], exclude: ['**/*.integration.test.ts'] } },
 { test: { name: 'integration', root, include: ['scripts/*.test.ts', 'packages/*/test/**/*.integration.test.ts', 'apps/*/test/**/*.integration.test.ts', 'tools/*/test/**/*.integration.test.ts'] } },
] } });
