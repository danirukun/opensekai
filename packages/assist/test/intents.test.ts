import { describe, expect, it } from 'vitest';
import { IntentSchema, IntentSchemas, INTENT_TOOLS, RefSchema, TOOL_CONTRACT_VERSION } from '../src';

const p = (v: unknown) => IntentSchema.safeParse(v).success;

describe('intent schemas', () => {
 it('accepts a full light intent and rejects hex, seconds, and raw IDs', () => {
  expect(p({ tool: 'light_setup', role: 'key', target: '@e1', direction: 'frontLeft', color: 'purple', intensity: 'bright' })).toBe(true);
  expect(p({ tool: 'light_setup', role: 'key', color: '#ff00ff' })).toBe(false);
  expect(p({ tool: 'camera_move', camera: '@e2', kind: 'orbit', duration: 4 })).toBe(false);
  expect(p({ tool: 'output_camera', camera: 'camera_main' })).toBe(false);
  expect(p({ tool: 'light_setup', role: 'key', extra: 1 })).toBe(false);
 });

 it('accepts short references only', () => {
  for (const r of ['@e1', '@b2', '@a3', '@e99999']) expect(RefSchema.safeParse(r).success).toBe(true);
  for (const r of ['@e0', '@x1', 'e1', '@e100000', '@e01', '@e']) expect(RefSchema.safeParse(r).success).toBe(false);
 });

 it('limits camera angle, count, and the camera side', () => {
  const move = { tool: 'camera_move', camera: '@e2', kind: 'orbit' };
  expect(p({ ...move, angleDegrees: 15 })).toBe(true);
  expect(p({ ...move, angleDegrees: 14 })).toBe(false);
  expect(p({ ...move, angleDegrees: 361 })).toBe(false);
  expect(p({ ...move, angleDegrees: 90.5 })).toBe(false);
  expect(p({ tool: 'prop_place', asset: '@a1', count: 8 })).toBe(true);
  expect(p({ tool: 'prop_place', asset: '@a1', count: 9 })).toBe(false);
  expect(p({ tool: 'camera_add', framing: 'wide', side: 'above' })).toBe(false);
  expect(p({ tool: 'camera_add', framing: 'wide', side: 'back' })).toBe(true);
 });

 it('limits blueprint actions to 1–8 and ask choices to 2–5', () => {
  const emit = { kind: 'emit', name: 'x' };
  const bp = (n: number) => ({ tool: 'blueprint_build', name: 'b', trigger: { kind: 'manual' }, actions: Array.from({ length: n }, () => emit) });
  expect(p(bp(0))).toBe(false);
  expect(p(bp(1))).toBe(true);
  expect(p(bp(8))).toBe(true);
  expect(p(bp(9))).toBe(false);
  const ask = (n: number) => ({ tool: 'ask', question: 'Which?', choices: Array.from({ length: n }, (_, i) => `c${i}`) });
  expect(p(ask(1))).toBe(false);
  expect(p(ask(2))).toBe(true);
  expect(p(ask(5))).toBe(true);
  expect(p(ask(6))).toBe(false);
 });

 it('checks blueprint triggers and actions', () => {
  const bp = (trigger: unknown, action: unknown) => ({ tool: 'blueprint_build', name: 'b', trigger, actions: [action] });
  expect(p(bp({ kind: 'hotkey', key: 'F1' }, { kind: 'expression', character: '@e1', expression: 'smile', mode: 'toggle' }))).toBe(true);
  expect(p(bp({ kind: 'youtube', event: 'superChat' }, { kind: 'wait', length: 'short' }))).toBe(true);
  expect(p(bp({ kind: 'youtube', event: 'like' }, { kind: 'wait', length: 'short' }))).toBe(false);
  expect(p(bp({ kind: 'showStart' }, { kind: 'wait', length: 2 }))).toBe(false);
  expect(p(bp({ kind: 'manual' }, { kind: 'visibility', entity: '@e3', mode: 'hide' }))).toBe(true);
  expect(p(bp({ kind: 'manual' }, { kind: 'switchCamera', camera: 'cam' }))).toBe(false);
 });

 it('has one strict schema per tool', () => {
  expect(TOOL_CONTRACT_VERSION).toBe(1);
  expect([...INTENT_TOOLS].sort()).toEqual(['ask', 'blueprint_build', 'camera_add', 'camera_move', 'environment_set', 'haze_set', 'light_setup', 'look_up', 'output_camera', 'prop_place']);
  expect(IntentSchemas.look_up.safeParse({ tool: 'look_up', ref: '@e1' }).success).toBe(true);
  expect(IntentSchemas.look_up.safeParse({ tool: 'look_up', ref: '@e1', extra: 1 }).success).toBe(false);
  expect(p({ tool: 'nope' })).toBe(false);
 });
});
