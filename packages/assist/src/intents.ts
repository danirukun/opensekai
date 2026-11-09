import { z } from 'zod';

export const TOOL_CONTRACT_VERSION = 1;

export const RefSchema = z.string().regex(/^@[eba][1-9][0-9]{0,4}$/);
export const DirectionSchema = z.enum(['front', 'frontLeft', 'left', 'backLeft', 'back', 'backRight', 'right', 'frontRight', 'above']);
export const SideSchema = z.enum(['front', 'frontLeft', 'left', 'backLeft', 'back', 'backRight', 'right', 'frontRight']);
export const HeightSchema = z.enum(['low', 'eye', 'high']);
export const ColorWordSchema = z.enum(['candle', 'warm', 'neutral', 'daylight', 'cool', 'white', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']);
export const IntensitySchema = z.enum(['dim', 'soft', 'normal', 'bright']);
export const FramingSchema = z.enum(['wide', 'medium', 'closeUp', 'extremeCloseUp']);
export const DurationSchema = z.enum(['quick', 'normal', 'slow', 'verySlow']);
export const EasingWordSchema = z.enum(['smooth', 'linear', 'easeIn', 'easeOut']);
export const HazeDensitySchema = z.enum(['off', 'light', 'medium', 'thick']);
export const ReflectionsSchema = z.enum(['off', 'low', 'normal', 'high']);
export const WaitSchema = z.enum(['short', 'medium', 'long']);

export type Ref = z.infer<typeof RefSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type Side = z.infer<typeof SideSchema>;
export type Height = z.infer<typeof HeightSchema>;
export type ColorWord = z.infer<typeof ColorWordSchema>;
export type Intensity = z.infer<typeof IntensitySchema>;
export type Framing = z.infer<typeof FramingSchema>;
export type Duration = z.infer<typeof DurationSchema>;
export type EasingWord = z.infer<typeof EasingWordSchema>;
export type HazeDensity = z.infer<typeof HazeDensitySchema>;
export type Reflections = z.infer<typeof ReflectionsSchema>;
export type Wait = z.infer<typeof WaitSchema>;

const name = z.string().min(1).max(64);
const tool = <T extends string>(t: T) => z.literal(t);

const BlueprintTriggerSchema = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('hotkey'), key: name }),
 z.strictObject({ kind: z.literal('manual') }),
 z.strictObject({ kind: z.literal('event'), name }),
 z.strictObject({ kind: z.literal('youtube'), event: z.enum(['chat', 'superChat', 'superSticker', 'newMember', 'memberMilestone']) }),
 z.strictObject({ kind: z.literal('showStart') }),
]);
const toggle = z.enum(['on', 'off', 'toggle']);
const BlueprintActionSchema = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('expression'), character: RefSchema, expression: name, mode: toggle }),
 z.strictObject({ kind: z.literal('visibility'), entity: RefSchema, mode: z.enum(['show', 'hide', 'toggle']) }),
 z.strictObject({ kind: z.literal('switchCamera'), camera: RefSchema }),
 z.strictObject({ kind: z.literal('wait'), length: WaitSchema }),
 z.strictObject({ kind: z.literal('emit'), name }),
]);
export type BlueprintTrigger = z.infer<typeof BlueprintTriggerSchema>;
export type BlueprintAction = z.infer<typeof BlueprintActionSchema>;

export const IntentSchemas = {
 light_setup: z.strictObject({
  tool: tool('light_setup'), role: z.enum(['key', 'fill', 'rim', 'ambient']),
  target: RefSchema.optional(), direction: DirectionSchema.optional(), height: HeightSchema.optional(),
  color: ColorWordSchema.optional(), intensity: IntensitySchema.optional(), shadow: z.boolean().optional(),
  name: name.optional(), replace: RefSchema.optional(),
 }),
 camera_add: z.strictObject({
  tool: tool('camera_add'), framing: FramingSchema, target: RefSchema.optional(),
  side: SideSchema.optional(), height: HeightSchema.optional(), name: name.optional(),
 }),
 camera_move: z.strictObject({
  tool: tool('camera_move'), camera: RefSchema, kind: z.enum(['orbit', 'dolly', 'pushIn', 'pullOut', 'crane']),
  target: RefSchema.optional(), angleDegrees: z.number().int().min(15).max(360).optional(),
  turn: z.enum(['left', 'right']).optional(), rise: z.enum(['up', 'down']).optional(),
  duration: DurationSchema.optional(), easing: EasingWordSchema.optional(), endFraming: FramingSchema.optional(),
  loop: z.boolean().optional(), name: name.optional(),
 }),
 environment_set: z.strictObject({ tool: tool('environment_set'), asset: RefSchema, reflections: ReflectionsSchema.optional() }),
 prop_place: z.strictObject({
  tool: tool('prop_place'), asset: RefSchema, near: RefSchema.optional(),
  relation: z.enum(['front', 'behind', 'left', 'right', 'around']).optional(),
  count: z.number().int().min(1).max(8).optional(), name: name.optional(),
 }),
 haze_set: z.strictObject({ tool: tool('haze_set'), density: HazeDensitySchema }),
 output_camera: z.strictObject({ tool: tool('output_camera'), camera: RefSchema }),
 blueprint_build: z.strictObject({
  tool: tool('blueprint_build'), name, trigger: BlueprintTriggerSchema,
  actions: z.array(BlueprintActionSchema).min(1).max(8), replace: RefSchema.optional(),
 }),
 ask: z.strictObject({ tool: tool('ask'), question: z.string().min(1).max(200), choices: z.array(name).min(2).max(5) }),
 look_up: z.strictObject({ tool: tool('look_up'), ref: RefSchema }),
};

export type IntentTool = keyof typeof IntentSchemas;
export const INTENT_TOOLS = Object.keys(IntentSchemas) as IntentTool[];
export const IntentSchema = z.discriminatedUnion('tool', [
 IntentSchemas.light_setup, IntentSchemas.camera_add, IntentSchemas.camera_move, IntentSchemas.environment_set,
 IntentSchemas.prop_place, IntentSchemas.haze_set, IntentSchemas.output_camera, IntentSchemas.blueprint_build,
 IntentSchemas.ask, IntentSchemas.look_up,
]);
export type Intent = z.infer<typeof IntentSchema>;
