import { readFileSync } from 'node:fs';
import { run } from './jsc-entry.mjs';
await run([0, 1, 2].map(k => readFileSync(new URL(`./json/a${k}.json`, import.meta.url), 'utf8')), 'V8/Node', process.env.MODE);
