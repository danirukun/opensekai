import { defaultBlueprintValue, isYouTubeNodeType, YOUTUBE_NODE_KINDS, YOUTUBE_NODE_OUTPUTS, type BlueprintNode, type YouTubeEvent, type YouTubeNodeType } from '@opensekai/contracts';
import type { Evaluator, EvaluatorTable } from './types';

// RunEnv lives in types.ts; the YouTube event that started a run is added here by declaration merging.
declare module './types' {
 interface RunEnv {
  youtube?: YouTubeEvent;
 }
}

// Whether a YouTube event starts a run at this node: each node takes only its own event kind.
export const youtubeTrigger = (node: BlueprintNode, event: YouTubeEvent): boolean =>
 isYouTubeNodeType(node.type) && YOUTUBE_NODE_KINDS[node.type] === event.kind;

// A data output reads the field of the event that started the run, else the type default.
const fields = (type: YouTubeNodeType): Evaluator<BlueprintNode> => ({
 data: (_node, output, _read, _state, env) => {
  const event = env.youtube, outputType = YOUTUBE_NODE_OUTPUTS[type][output] ?? 'string';
  if (event?.kind !== YOUTUBE_NODE_KINDS[type] || !Object.hasOwn(event, output)) return defaultBlueprintValue(outputType);
  return (event as Record<string, string | number | boolean>)[output]!;
 },
});

export const YOUTUBE_EVALUATORS = {
 'youtube.chat': fields('youtube.chat'),
 'youtube.superChat': fields('youtube.superChat'),
 'youtube.superSticker': fields('youtube.superSticker'),
 'youtube.newMember': fields('youtube.newMember'),
 'youtube.memberMilestone': fields('youtube.memberMilestone'),
 'youtube.giftMemberships': fields('youtube.giftMemberships'),
 'youtube.status': fields('youtube.status'),
} satisfies Partial<EvaluatorTable>;
