import type { DataType } from '../blueprint-values';
import type { YouTubeEvent } from '../youtube';
import { defineNode, empty, type PortShape } from './define';

// The YouTube event nodes (B25 R15). Each starts on the events of its kind from the connected stream; its data outputs read the event fields.
const author = { username: 'string', userChannelId: 'string' } as const;
const outputs = {
 'youtube.chat': { message: 'string', ...author, avatarUrl: 'string', isMember: 'boolean', isModerator: 'boolean', isOwner: 'boolean', isVerified: 'boolean' },
 'youtube.superChat': { message: 'string', ...author, avatarUrl: 'string', amount: 'string', amountMicros: 'number', currency: 'string', tierColor: 'string' },
 'youtube.superSticker': { stickerName: 'string', stickerImageUrl: 'string', ...author, amount: 'string', currency: 'string' },
 'youtube.newMember': { ...author, avatarUrl: 'string', levelName: 'string' },
 'youtube.memberMilestone': { ...author, months: 'integer', message: 'string' },
 'youtube.giftMemberships': { ...author, count: 'integer' },
 'youtube.status': { status: 'string' },
} as const satisfies Record<string, Record<string, DataType>>;
export type YouTubeNodeType = keyof typeof outputs;
// The event kind that starts each node type.
export const YOUTUBE_NODE_KINDS = {
 'youtube.chat': 'chat', 'youtube.superChat': 'superChat', 'youtube.superSticker': 'superSticker', 'youtube.newMember': 'newMember',
 'youtube.memberMilestone': 'memberMilestone', 'youtube.giftMemberships': 'giftMemberships', 'youtube.status': 'status',
} as const satisfies Record<YouTubeNodeType, YouTubeEvent['kind']>;
export const YOUTUBE_NODE_OUTPUTS: Readonly<Record<YouTubeNodeType, Readonly<Record<string, DataType>>>> = outputs;
export const isYouTubeNodeType = (type: string): type is YouTubeNodeType => Object.hasOwn(outputs, type);

const ports = (type: YouTubeNodeType) => (): PortShape => ({ inputs: {}, outputs: { flow: 'flow', ...outputs[type] } });
const shared = ['youtube', 'stream', 'live', 'chat'];
const node = <const T extends YouTubeNodeType>(type: T, label: string, keywords: readonly string[]) =>
 defineNode({ type, label, category: 'YouTube', keywords: [...shared, ...keywords], settings: empty, ports: ports(type), defaults: () => ({}), fields: [] });

export const YOUTUBE_NODES = [
 node('youtube.chat', 'On YouTube Chat Received', ['message', 'comment', 'command']),
 node('youtube.superChat', 'On YouTube Super Chat Received', ['super chat', 'donation', 'tip', 'paid', 'money']),
 node('youtube.superSticker', 'On YouTube Super Sticker Received', ['super sticker', 'sticker', 'donation', 'paid']),
 node('youtube.newMember', 'On YouTube New Member', ['member', 'membership', 'join', 'subscribe']),
 node('youtube.memberMilestone', 'On YouTube Member Milestone', ['member', 'membership', 'milestone', 'months', 'anniversary']),
 node('youtube.giftMemberships', 'On YouTube Gift Memberships', ['gift', 'member', 'membership']),
 node('youtube.status', 'On YouTube Stream Status Changed', ['status', 'start', 'end', 'offline', 'connection']),
] as const;
