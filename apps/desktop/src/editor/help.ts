import type {SceneEntity} from '@opensekai/contracts';
// The order of fixtures/protocol/help-topics.json. Rust builds the URL of each topic (B40a).
export const HELP_TOPICS=['gettingStarted','scene','character','motionCapture','vmcSender','environment','prop','light','haze','screen','fpsCounter','camera','output','blueprints','resources','settings'] as const;
export type HelpTopic=typeof HELP_TOPICS[number];
const KIND_TOPICS:Record<SceneEntity['kind'],HelpTopic>={avatar:'character',mesh:'prop',tracking:'motionCapture',environment:'environment',light:'light',haze:'haze',fpsCounter:'fpsCounter',vmcSender:'vmcSender',screen:'screen',camera:'camera'};
export const topicForKind=(kind:SceneEntity['kind']|null):HelpTopic=>kind?KIND_TOPICS[kind]:'scene';
