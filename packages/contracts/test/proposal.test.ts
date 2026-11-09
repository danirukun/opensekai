import { expect, it } from 'vitest';
import { fingerprint, validateCall, requiredCapability, ProposalApplyResultSchema } from '../src';

const ok = { sceneId: 's', expect: { entities: [], blueprints: [] }, sceneOps: [], blueprint: null, output: { outputId: 'o', cameraId: 'c' } };
const rm = { kind: 'removeEntity', entityId: 'x' };

it('fingerprint ignores key order and changes with values', () => {
 expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
 expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
 expect(fingerprint({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
 expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
});
it('fingerprint skips undefined keys like JSON', () => {
 expect(fingerprint({ a: 1, b: undefined })).toBe(fingerprint({ a: 1 }));
 expect(fingerprint({ a: { c: undefined, d: 2 } })).toBe(fingerprint(JSON.parse(JSON.stringify({ a: { c: undefined, d: 2 } }))));
 expect(fingerprint([1, undefined])).toBe(fingerprint([1, null]));
});
it('validates proposalApply limits', () => {
 expect(validateCall('proposalApply', ok).ok).toBe(true);
 expect(validateCall('proposalApply', { ...ok, output: null }).ok).toBe(false);
 expect(validateCall('proposalApply', { ...ok, output: null, sceneOps: [rm] }).ok).toBe(true);
 expect(validateCall('proposalApply', { ...ok, sceneOps: Array(64).fill(rm) }).ok).toBe(true);
 expect(validateCall('proposalApply', { ...ok, sceneOps: Array(65).fill(rm) }).ok).toBe(false);
 expect(validateCall('proposalApply', { ...ok, expect: { entities: Array(65).fill({ id: 'x', fingerprint: null }), blueprints: [] } }).ok).toBe(false);
 expect(validateCall('proposalApply', { ...ok, expect: { entities: [], blueprints: Array(17).fill({ id: 'x', fingerprint: null }) } }).ok).toBe(false);
 expect(validateCall('proposalApply', { ...ok, expect: { entities: [{ id: 'x', fingerprint: 'ABC' }], blueprints: [] } }).ok).toBe(false);
 expect(requiredCapability('proposalApply')).toBe('edit');
});
it('proposalApply result carries an optional blueprint edit result', () => {
 expect(ProposalApplyResultSchema.safeParse({ revision: 3, blueprint: null }).success).toBe(true);
 expect(ProposalApplyResultSchema.safeParse({ revision: 3, blueprint: { revision: 1, keystrokes: ['KeyA'] } }).success).toBe(true);
 expect(ProposalApplyResultSchema.safeParse({ revision: 3 }).success).toBe(false);
});
