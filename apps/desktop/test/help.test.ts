import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/help-topics.json';
import { HELP_TOPICS, topicForKind } from '../src/editor/help';

it('lists the help topics of the shared fixture in its order', () => {
 expect([...HELP_TOPICS]).toEqual(fixture);
});

it('maps each entity kind to the topic of its handbook section, and no selection to scene', () => {
 expect(topicForKind(null)).toBe('scene');
 expect(topicForKind('avatar')).toBe('character');
 expect(topicForKind('mesh')).toBe('prop');
 expect(topicForKind('tracking')).toBe('motionCapture');
 for (const kind of ['environment', 'light', 'haze', 'fpsCounter', 'vmcSender', 'screen', 'camera'] as const) expect(topicForKind(kind)).toBe(kind);
});
