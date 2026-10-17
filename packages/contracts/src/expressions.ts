import { z } from 'zod';

export const ARKIT_NAMES = [
 'eyeBlinkLeft','eyeLookDownLeft','eyeLookInLeft','eyeLookOutLeft','eyeLookUpLeft','eyeSquintLeft','eyeWideLeft',
 'eyeBlinkRight','eyeLookDownRight','eyeLookInRight','eyeLookOutRight','eyeLookUpRight','eyeSquintRight','eyeWideRight',
 'jawForward','jawLeft','jawRight','jawOpen','mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight',
 'mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight',
 'mouthStretchLeft','mouthStretchRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper',
 'mouthPressLeft','mouthPressRight','mouthLowerDownLeft','mouthLowerDownRight','mouthUpperUpLeft','mouthUpperUpRight',
 'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight','cheekPuff','cheekSquintLeft',
 'cheekSquintRight','noseSneerLeft','noseSneerRight','tongueOut'
] as const;
const canonicalNames = new Map<string, string>();
for (const name of ARKIT_NAMES) {
 canonicalNames.set(name.toLowerCase(), name);
 canonicalNames.set(name.replace(/Left$/, '_L').replace(/Right$/, '_R').toLowerCase(), name);
}
export const canonicalArkitName = (name: string): string | undefined => canonicalNames.get(name.toLowerCase());

export interface AssetExpression { name: string; preset: boolean }
export interface ExpressionSuppress { blink: boolean; mouth: boolean; brow: boolean }
export interface ExpressionSettings { layer: number; fadeSeconds: number; suppress: ExpressionSuppress }
export interface ExpressionView extends ExpressionSettings { name: string; preset: boolean; active: boolean; weight: number }
export interface ExpressionState { avatarId: string; expressions: ExpressionView[] }

export const MAX_EXPRESSIONS = 64;
export const ExpressionNameSchema = z.string().min(1).max(128);
export const AssetExpressionSchema = z.strictObject({ name: ExpressionNameSchema, preset: z.boolean() });
export const AssetExpressionsSchema = z.array(AssetExpressionSchema).max(MAX_EXPRESSIONS)
 .refine(list => new Set(list.map(entry => entry.name)).size === list.length, 'Duplicate expression name');
export const ExpressionSettingsSchema = z.strictObject({
 layer: z.number().int().min(0).max(15),
 fadeSeconds: z.number().finite().min(0).max(5),
 suppress: z.strictObject({ blink: z.boolean(), mouth: z.boolean(), brow: z.boolean() }),
});
export const AvatarExpressionsSchema = z.record(ExpressionNameSchema, ExpressionSettingsSchema)
 .refine(map => Object.keys(map).length <= MAX_EXPRESSIONS, 'Too many expression settings');
export const ExpressionViewSchema = ExpressionSettingsSchema.extend({ name: ExpressionNameSchema, preset: z.boolean(), active: z.boolean(), weight: z.number().finite().min(0).max(1) });
export const ExpressionStateSchema = z.strictObject({ avatarId: z.string().min(1).max(256), expressions: z.array(ExpressionViewSchema).max(MAX_EXPRESSIONS) });

// Names that face tracking or lip sync drives (VRM presets and the OVR visemes). Lower case, so the comparison ignores case.
// Keep in step with `is_tracked_expression` in the Rust contracts.
const VISEMES = ['sil', 'pp', 'ff', 'th', 'dd', 'kk', 'ch', 'ss', 'nn', 'rr'];
const TRACKED = new Set(['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkleft', 'blinkright', 'lookup', 'lookdown', 'lookleft', 'lookright', 'neutral', ...VISEMES]);
export const isTrackedExpression = (name: string): boolean => TRACKED.has(name.toLowerCase()) || canonicalArkitName(name) !== undefined;
export const triggerableExpressions = (record: { expressions: readonly AssetExpression[] }): AssetExpression[] =>
 record.expressions.filter(entry => !isTrackedExpression(entry.name));

export const DEFAULT_FADE_SECONDS = 0.4;
// The settings of each triggerable expression: the stored entry, or the Warudo default (presets on layer 0, each custom expression on its own layer).
export function effectiveExpressionSettings(record: { expressions: readonly AssetExpression[] }, stored: Readonly<Record<string, ExpressionSettings>> | undefined): (AssetExpression & ExpressionSettings)[] {
 let custom = 0;
 return triggerableExpressions(record).map(entry => {
  const layer = entry.preset ? 0 : Math.min(1 + custom++, 15);
  const settings = stored && Object.hasOwn(stored, entry.name) ? stored[entry.name]! : { layer, fadeSeconds: DEFAULT_FADE_SECONDS, suppress: { blink: false, mouth: false, brow: false } };
  return { ...entry, ...structuredClone(settings) };
 });
}

export type SuppressGroup = keyof ExpressionSuppress;
const MOUTH_NAMES = new Set(['tongueout', 'aa', 'ih', 'ou', 'ee', 'oh', ...VISEMES]);
export function trackingGroup(name: string): SuppressGroup | null {
 const lower = name.toLowerCase();
 if (lower.startsWith('eyeblink') || lower.startsWith('blink')) return 'blink';
 if (lower.startsWith('jaw') || lower.startsWith('mouth') || lower.startsWith('cheek') || MOUTH_NAMES.has(lower)) return 'mouth';
 if (lower.startsWith('brow')) return 'brow';
 return null;
}
