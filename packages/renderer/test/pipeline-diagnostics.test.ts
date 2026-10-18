import { describe, expect, it, vi } from 'vitest';
import { bracketNesting, watchPipelineErrors, MAX_REPORTED_FAILURES, type PipelineDevice } from '../src/pipeline-diagnostics';

const fakeDevice = (errors: { sync?: string; async?: string } = {}) => {
    const scopes: string[] = [];
    const device: PipelineDevice = {
        createShaderModule: ({ code }) => ({ code }),
        createRenderPipeline: () => { if (errors.sync) scopes.push(errors.sync); return {}; },
        createRenderPipelineAsync: () => errors.async ? Promise.reject(new Error(errors.async)) : Promise.resolve({}),
        pushErrorScope: () => undefined,
        popErrorScope: () => Promise.resolve(scopes.length ? { message: scopes.shift()! } : null),
    };
    return device;
};
const descriptor = (device: PipelineDevice, fragment: string) => ({ label: 'mesh', vertex: { module: device.createShaderModule({ code: 'fn v() {}' }) }, fragment: { module: device.createShaderModule({ code: fragment }) } });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('pipeline diagnostics (owner QA finding 2, option 3)', () => {
    it('measures bracket nesting', () => {
        expect(bracketNesting('a(b[c{d}])')).toBe(3);
        expect(bracketNesting('')).toBe(0);
    });
    it('reports a failed async pipeline with its WGSL and keeps the rejection', async () => {
        const device = fakeDevice({ async: 'bracket nesting level exceeded maximum of 256' });
        const report = vi.fn();
        watchPipelineErrors(device, report);
        await expect(device.createRenderPipelineAsync(descriptor(device, 'fn f() { ((x)) }'))).rejects.toThrow('bracket nesting');
        expect(report).toHaveBeenCalledWith({ message: 'bracket nesting level exceeded maximum of 256', label: 'mesh', vertex: 'fn v() {}', fragment: 'fn f() { ((x)) }', maxNesting: 3 }, true);
    });
    it('reports a failed sync pipeline from its error scope, once for each shader pair', async () => {
        const device = fakeDevice({ sync: 'invalid' });
        const report = vi.fn();
        watchPipelineErrors(device, report);
        const d = descriptor(device, 'fn f() {}');
        device.createRenderPipeline(d); device.createRenderPipeline(d); await settle();
        expect(report.mock.calls.map(call => call[1])).toEqual([true, false]);
    });
    it('stays silent for a good pipeline and logs at most 16 distinct failures', async () => {
        const good = fakeDevice(), report = vi.fn();
        watchPipelineErrors(good, report);
        good.createRenderPipeline(descriptor(good, 'ok')); await good.createRenderPipelineAsync(descriptor(good, 'ok')); await settle();
        expect(report).not.toHaveBeenCalled();
        const bad = fakeDevice({ sync: 'x' }), many = vi.fn();
        watchPipelineErrors(bad, many);
        for (let i = 0; i < MAX_REPORTED_FAILURES + 4; i++) { bad.createRenderPipeline(descriptor(bad, `fn f${i}() {}`)); }
        await settle();
        expect(many).toHaveBeenCalledTimes(MAX_REPORTED_FAILURES + 4);
        expect(many.mock.calls.filter(call => call[1]).length).toBe(MAX_REPORTED_FAILURES);
    });
    it('restores the device methods', () => {
        const device = fakeDevice(), before = device.createRenderPipeline;
        const restore = watchPipelineErrors(device, vi.fn());
        expect(device.createRenderPipeline).not.toBe(before);
        restore();
        expect(device.createRenderPipeline).toBe(before);
    });
});
describe('pipeline failure log', () => {
    it('logs a message longer than 2000 characters in full, so the compiler error line is kept', async () => {
        const { logPipelineFailure } = await import('../src/pipeline-diagnostics');
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const message = 'x'.repeat(5000) + '\nprogram_source:1: error: bracket nesting level exceeded maximum of 256';
        logPipelineFailure({ message, label: 'shadow', vertex: 'v', fragment: 'f', maxNesting: 3 });
        expect(error.mock.calls.some(call => String(call[0]).endsWith('exceeded maximum of 256'))).toBe(true);
        error.mockClear();
        logPipelineFailure({ message: 'short', label: null, vertex: null, fragment: null, maxNesting: 0 });
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });
});
