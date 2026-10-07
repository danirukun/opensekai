import type { z } from 'zod';
import { ShowDocumentSchema } from './schema';

export { ShowDocumentSchema } from './schema';
export type ShowDocument = z.infer<typeof ShowDocumentSchema>;
