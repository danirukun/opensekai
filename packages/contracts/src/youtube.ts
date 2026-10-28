import { z } from 'zod';
import { MAX_BLUEPRINT_STRING_LENGTH } from './blueprint-values';

// YouTube chat events on the clock, the YouTube status, and the integrationsSet call (B25). Mirrored in crates/contracts/src/youtube.rs.
export const YOUTUBE_STREAM_STATUSES = ['waiting', 'live', 'ended', 'error'] as const;
export const YOUTUBE_STATES = ['notConnected', ...YOUTUBE_STREAM_STATUSES] as const;
export const MAX_YOUTUBE_CLOCK_EVENTS = 8;
export const MAX_YOUTUBE_NAME = 256;
export const MAX_YOUTUBE_LINK = 2048;
export const MAX_YOUTUBE_COUNT = 10_000;

const text = z.string().max(MAX_BLUEPRINT_STRING_LENGTH), name = z.string().max(MAX_YOUTUBE_NAME), id = name.min(1);
const count = z.number().int().min(0).max(MAX_YOUTUBE_COUNT);
const author = { id, username: name, userChannelId: name };
export const YouTubeStreamStatusSchema = z.enum(YOUTUBE_STREAM_STATUSES);
export const YouTubeEventSchema = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('chat'), ...author, message: text, avatarUrl: text, isMember: z.boolean(), isModerator: z.boolean(), isOwner: z.boolean(), isVerified: z.boolean() }),
 z.strictObject({ kind: z.literal('superChat'), ...author, message: text, avatarUrl: text, amount: name, amountMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), currency: name, tierColor: z.union([z.literal(''), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]) }),
 z.strictObject({ kind: z.literal('superSticker'), ...author, stickerName: name, stickerImageUrl: text, amount: name, currency: name }),
 z.strictObject({ kind: z.literal('newMember'), ...author, avatarUrl: text, levelName: name }),
 z.strictObject({ kind: z.literal('memberMilestone'), ...author, months: count, message: text }),
 z.strictObject({ kind: z.literal('giftMemberships'), ...author, count }),
 z.strictObject({ kind: z.literal('status'), status: YouTubeStreamStatusSchema }),
]);
export const YouTubeInputSchema = z.strictObject({ events: z.array(YouTubeEventSchema).min(1).max(MAX_YOUTUBE_CLOCK_EVENTS) });
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const YouTubeStatusSchema = z.strictObject({
 link: z.string().min(1).max(MAX_YOUTUBE_LINK).nullable(),
 state: z.enum(YOUTUBE_STATES),
 error: name.nullable(),
 videoId: id.nullable(),
 items: counter, skipped: counter, redemptions: counter, dropped: counter,
}).refine(status => (status.error !== null) === (status.state === 'error'), 'An error text belongs to the error state only');
// Only the host parses the link (Rust `parse_stream_link`); this schema checks the shape and the length.
export const IntegrationsSetParamsSchema = z.strictObject({ youtube: z.strictObject({ link: z.string().max(MAX_YOUTUBE_LINK).nullable() }) });

export type YouTubeStreamStatus = z.infer<typeof YouTubeStreamStatusSchema>;
export type YouTubeEvent = z.infer<typeof YouTubeEventSchema>;
export type YouTubeInput = z.infer<typeof YouTubeInputSchema>;
export type YouTubeStatus = z.infer<typeof YouTubeStatusSchema>;
export type IntegrationsSetParams = z.infer<typeof IntegrationsSetParamsSchema>;
