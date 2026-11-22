import { expect, it } from 'vitest';
import { AppStatusSchema } from '../src/index';

const base = { schemaVersion: 1, sessionId: 's', ready: true, revision: 1, capabilities: ['read'], warnings: [], outputs: [] };
it('accepts the scene ID of the latest frame, accepts a status before the first frame, and rejects an empty ID', () => {
 expect(AppStatusSchema.safeParse({ ...base, sceneId: 'scene_b' }).success).toBe(true);
 expect(AppStatusSchema.safeParse(base).success).toBe(true);
 expect(AppStatusSchema.safeParse({ ...base, sceneId: '' }).success).toBe(false);
});
it('accepts the GPU timer of an output and rejects an unknown value', () => {
 const output = { outputId: 'output_main', connected: true, lastFrame: null };
 expect(AppStatusSchema.safeParse({ ...base, outputs: [{ ...output, gpuTimer: 'unsupported' }] }).success).toBe(true);
 expect(AppStatusSchema.safeParse({ ...base, outputs: [{ ...output, gpuTimer: 'maybe' }] }).success).toBe(false);
});
