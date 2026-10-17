// Node worker threads do not apply `--import tsx` before the entry resolves its imports, so register tsx here first.
import { register } from 'tsx/esm/api';

register();
await import('./worker-entry.ts');
