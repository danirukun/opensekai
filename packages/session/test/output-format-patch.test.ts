import { expect, it } from 'vitest';
import { makeSmokeScene, type OutputSpec } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const format = (change: Record<string, unknown> = {}) => ({ kind: 'setOutputFormat', outputId: 'output_main', width: 1280, height: 720, fps: 30, renderScale: 0.75, ...change });
const output = (s: ReturnType<typeof createSession>, id: string) => s.inspect().outputs.find(o => o.id === id) as OutputSpec;

it('replaces the format of output_main and keeps its camera (R3)', () => {
    const s = createSession(makeSmokeScene(), 'output-test');
    const camera = output(s, 'output_main').cameraId;
    expect(s.applyPatch(patch(0, [format()]))).toMatchObject({ ok: true });
    expect(output(s, 'output_main')).toEqual({ id: 'output_main', cameraId: camera, width: 1280, height: 720, fps: 30, renderScale: 0.75 });
    // A value of 1 is stored, not removed.
    expect(s.applyPatch(patch(1, [format({ width: 1920, height: 1080, fps: 60, renderScale: 1 })]))).toMatchObject({ ok: true });
    expect(output(s, 'output_main')).toMatchObject({ width: 1920, height: 1080, fps: 60, renderScale: 1 });
});
it('accepts a call without a change of value (R3)', () => {
    const s = createSession(makeSmokeScene(), 'output-test');
    expect(s.applyPatch(patch(0, [format()])).ok).toBe(true);
    const before = output(s, 'output_main');
    expect(s.applyPatch(patch(1, [format()])).ok).toBe(true);
    expect(output(s, 'output_main')).toEqual(before);
});
it('refuses preview_main, an unknown output, and a bad preset without a change (R2, R3)', () => {
    const s = createSession(makeSmokeScene(), 'output-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [format({ outputId: 'preview_main' })]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['preview_main'] } });
    expect(s.applyPatch(patch(0, [format({ outputId: 'output_side' })]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['output_side'] } });
    expect(s.applyPatch(patch(0, [format({ width: 1920, height: 720 })]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [format({ fps: 24 })]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
it('keeps a missing render scale missing on other patches (R1)', () => {
    const s = createSession(makeSmokeScene(), 'output-test');
    expect('renderScale' in output(s, 'output_main')).toBe(false);
    expect(s.applyPatch(patch(0, [{ kind: 'renameEntity', entityId: 'performer', name: 'Lead' }])).ok).toBe(true);
    expect('renderScale' in output(s, 'output_main')).toBe(false);
});
