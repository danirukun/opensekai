import { z } from 'zod';
import { defineNode, empty, exit } from './define';
import { NameSetting, nameField } from './typed';

const Named = z.strictObject({ name: NameSetting });
export const TIMER_NODES = [
 defineNode({ type: 'timer.start', label: 'Start Timer', category: 'Timer', keywords: ['interval', 'repeat', 'every', 'schedule', 'clock'], settings: z.strictObject({ name: NameSetting, repeat: z.boolean() }), ports: () => ({ inputs: { flow: 'flow', seconds: 'number' }, outputs: { ...exit } }), defaults: () => ({ name: 'Timer', repeat: true }), fields: [nameField, { key: 'repeat', label: 'Repeat', kind: 'boolean' }], inputDefaults: { seconds: 1 } }),
 defineNode({ type: 'timer.stop', label: 'Stop Timer', category: 'Timer', keywords: ['cancel', 'clear', 'interval', 'clock'], settings: Named, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: () => ({ name: 'Timer' }), fields: [nameField] }),
 defineNode({ type: 'timer.on', label: 'On Timer', category: 'Timer', keywords: ['tick', 'interval', 'elapsed', 'every', 'clock'], settings: Named, ports: () => ({ inputs: {}, outputs: { flow: 'flow' } }), defaults: () => ({ name: 'Timer' }), fields: [nameField] }),
 defineNode({ type: 'timer.sessionTime', label: 'Get Session Time', category: 'Timer', keywords: ['time', 'now', 'clock', 'seconds', 'elapsed'], settings: empty, ports: () => ({ inputs: {}, outputs: { seconds: 'number' } }), defaults: () => ({}), fields: [] }),
] as const;
