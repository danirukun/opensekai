import { describe, expect, it } from 'vitest';
import { freshModulePerPipeline, isWebKit } from '../src/webkit-shader-modules';
import type { PipelineDevice } from '../src/pipeline-diagnostics';

const fakeDevice = () => {
    const made: { code: string }[] = [], used: unknown[] = [];
    const device: PipelineDevice = {
        createShaderModule: ({ code }) => { const module = { code }; made.push(module); return module; },
        createRenderPipeline: descriptor => { used.push(descriptor.vertex.module, descriptor.fragment?.module); return {}; },
        createRenderPipelineAsync: descriptor => { used.push(descriptor.vertex.module, descriptor.fragment?.module); return Promise.resolve({}); },
        pushErrorScope: () => undefined,
        popErrorScope: () => Promise.resolve(null),
    };
    return { device, made, used };
};

describe('WebKit shader module reuse (R9b)', () => {
    it('gives each pipeline new modules made from the same WGSL', async () => {
        const { device, made, used } = fakeDevice();
        freshModulePerPipeline(device);
        const vertex = device.createShaderModule({ code: 'vertex' }), fragment = device.createShaderModule({ code: 'fragment' });
        device.createRenderPipeline({ vertex: { module: vertex }, fragment: { module: fragment } });
        await device.createRenderPipelineAsync({ vertex: { module: vertex }, fragment: { module: fragment } });
        expect(used).toHaveLength(4);
        expect(new Set(used).size).toBe(4);
        expect(used).not.toContain(vertex);
        expect(used.map(module => (module as { code: string }).code)).toEqual(['vertex', 'fragment', 'vertex', 'fragment']);
        expect(made).toHaveLength(6);
    });
    it('restores the shared modules', () => {
        const { device, used } = fakeDevice();
        const restore = freshModulePerPipeline(device);
        restore();
        const vertex = device.createShaderModule({ code: 'vertex' });
        device.createRenderPipeline({ vertex: { module: vertex } });
        expect(used[0]).toBe(vertex);
    });
    it('detects WebKit and not Chromium', () => {
        expect(isWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(true);
        expect(isWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36')).toBe(false);
        expect(isWebKit('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe(false);
    });
});
