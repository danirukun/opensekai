import { z } from 'zod';

export const MAX_BLUEPRINT_COMMENTS = 32;
export const MAX_COMMENT_TEXT = 512;
export const MIN_COMMENT_SIZE = 64;
export const MAX_COMMENT_SIZE = 8192;

const Extent = z.number().finite().min(MIN_COMMENT_SIZE).max(MAX_COMMENT_SIZE);
export const BlueprintCommentTextSchema = z.string().max(MAX_COMMENT_TEXT);
export const BlueprintCommentPositionSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
export const BlueprintCommentSizeSchema = z.strictObject({ width: Extent, height: Extent });
export const BlueprintCommentSchema = z.strictObject({
 id: z.string().min(1).max(256),
 text: BlueprintCommentTextSchema,
 position: BlueprintCommentPositionSchema,
 size: BlueprintCommentSizeSchema,
});
export const BlueprintCommentsSchema = z.array(BlueprintCommentSchema).max(MAX_BLUEPRINT_COMMENTS)
 .refine(comments => new Set(comments.map(comment => comment.id)).size === comments.length, 'Duplicate comment ID');
export type BlueprintComment = z.infer<typeof BlueprintCommentSchema>;
