import { z } from 'zod';
import { ExpressionNameSchema } from '../expressions';
import { defineNode, exit, IdSchema } from './define';

const target = z.strictObject({ entityId: IdSchema, expression: ExpressionNameSchema });
const fields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'expression', label: 'Expression', kind: 'expression' }] as const;
const defaults = (refs: { avatarId?: string; expression?: string }) => refs.avatarId && refs.expression ? { entityId: refs.avatarId, expression: refs.expression } : null;
export const CHARACTER_NODES = [
 defineNode({ type: 'character.setExpression', label: 'Set Expression', category: 'Character', keywords: ['expression', 'face', 'emote', 'blendshape'], settings: target, ports: () => ({ inputs: { flow: 'flow', active: 'boolean' }, outputs: { ...exit } }), defaults, fields }),
 defineNode({ type: 'character.toggleExpression', label: 'Toggle Expression', category: 'Character', keywords: ['expression', 'face', 'emote', 'blendshape'], settings: target, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults, fields }),
] as const;
