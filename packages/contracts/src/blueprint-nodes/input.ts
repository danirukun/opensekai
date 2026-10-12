import { z } from 'zod';
import codes from '../../../../fixtures/protocol/keystroke-codes.json';
import { defineNode } from './define';

const Code = z.enum(codes as [string, ...string[]]);
export const INPUT_NODES = [
 defineNode({ type: 'input.keyHeld', label: 'Is Key Held', category: 'Input', keywords: ['key', 'down', 'hold', 'keyboard', 'pressed'], settings: z.strictObject({ code: Code }), ports: () => ({ inputs: {}, outputs: { held: 'boolean' } }), defaults: () => ({ code: 'KeyW' }), fields: [{ key: 'code', label: 'Key', kind: 'key' }] }),
 defineNode({ type: 'input.keyAxis', label: 'Key Axis', category: 'Input', keywords: ['wasd', 'arrows', 'move', 'axis', 'keyboard'], settings: z.strictObject({ negative: Code, positive: Code }), ports: () => ({ inputs: {}, outputs: { value: 'number' } }), defaults: () => ({ negative: 'KeyS', positive: 'KeyW' }), fields: [{ key: 'negative', label: 'Negative', kind: 'key' }, { key: 'positive', label: 'Positive', kind: 'key' }] }),
] as const;
