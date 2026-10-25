import { expect, it } from 'vitest';
import { defaultBlueprintSettings, makeSmokeScene, NODE_DEFINITIONS, nodeDefinition, type AvatarPose, type BlueprintNodeOf } from '@opensekai/contracts';
import { EVALUATORS, NO_ENV } from '../src/blueprint-eval';
import { trackedBlendShape } from '../src/blueprint-eval/tracking';

const keystroke = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
const scene = makeSmokeScene();
const avatar = scene.entities.find(entity => entity.kind === 'avatar')!;
const pose = (expressions: Record<string, number>): AvatarPose => ({ avatarId: avatar.id, bones: {}, expressions });
const node = { id: 'n', version: 1, position: { x: 0, y: 0 }, type: 'tracking.getBlendShape', settings: { entityId: avatar.id, blendShape: 'eyeBlinkLeft' } } as BlueprintNodeOf<'tracking.getBlendShape'>;
const read = (previous: AvatarPose | null) => (EVALUATORS['tracking.getBlendShape'] as unknown as { data: (...args: unknown[]) => unknown }).data(node, {}, {}, {}, { ...NO_ENV, scene: () => scene, previousPose: () => previous });

it('reads a blend shape from the previous pose by its canonical name', () => {
 expect(read(pose({ eyeBlink_L: 0.6 }))).toBe(0.6);
 expect(read(pose({ eyeBlinkLeft: 0.2, eyeBlink_L: 0.6 }))).toBe(0.6);
 expect(read(pose({ jawOpen: 0.9 }))).toBe(0);
});

it('reads 0 without a pose', () => {
 expect(read(null)).toBe(0);
 expect(trackedBlendShape(null, 'jawOpen')).toBe(0);
});

it('parses its defaults and sits in the Tracking category', () => {
 const settings = defaultBlueprintSettings('tracking.getBlendShape', { avatarId: 'a', keystroke });
 expect(nodeDefinition('tracking.getBlendShape').settings.safeParse(settings).success).toBe(true);
 expect(defaultBlueprintSettings('tracking.getBlendShape', { keystroke })).toBeNull();
 expect(NODE_DEFINITIONS.find(d => d.type === 'tracking.getBlendShape')).toMatchObject({ label: 'Get Tracking Blend Shape', category: 'Tracking' });
});
