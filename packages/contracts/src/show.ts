import { z } from 'zod';
import { ShowDocumentSchema } from './schema';

export { ShowDocumentSchema } from './schema';
export type ShowDocument = z.infer<typeof ShowDocumentSchema>;

/** A recent show as the host lists it: the file name and its folder name, never the path. */
export const RecentShowSchema = z.strictObject({ name: z.string().max(256), folder: z.string().max(256) });
export type RecentShow = z.infer<typeof RecentShowSchema>;
export const ShowTemplateSchema = z.strictObject({ id: z.string().min(1).max(64), name: z.string().min(1).max(128) });
export type ShowTemplate = z.infer<typeof ShowTemplateSchema>;
