import type { PipelineDevice } from "./pipeline-diagnostics";

// The system WebKit adds one more array bounds clamp to a shader module each time a pipeline uses it, and the 255th
// pipeline from one module fails in Metal ("bracket nesting level exceeded maximum of 256"). A new module from the same
// WGSL for each pipeline keeps the clamp count at one (R9b).
type Stage = { module: object; entryPoint?: string };
type Descriptor = Parameters<PipelineDevice["createRenderPipeline"]>[0];

export const isWebKit = (userAgent: string): boolean => /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Edg\//.test(userAgent);

/** Makes each render pipeline of `device` use new shader modules. Returns a function that restores the methods. */
export function freshModulePerPipeline(device: PipelineDevice): () => void {
    const original = { createShaderModule: device.createShaderModule, createRenderPipeline: device.createRenderPipeline, createRenderPipelineAsync: device.createRenderPipelineAsync };
    const sources = new WeakMap<object, { code: string; label?: string }>();
    const fresh = (stage: Stage): Stage => {
        const source = sources.get(stage.module);
        return source ? { ...stage, module: device.createShaderModule(source) } : stage;
    };
    const renew = (descriptor: Descriptor): Descriptor => ({ ...descriptor, vertex: fresh(descriptor.vertex), ...(descriptor.fragment ? { fragment: fresh(descriptor.fragment) } : {}) });
    device.createShaderModule = function (descriptor) {
        const module = original.createShaderModule.call(this, descriptor);
        sources.set(module, descriptor);
        return module;
    };
    device.createRenderPipeline = function (descriptor) { return original.createRenderPipeline.call(this, renew(descriptor)); };
    device.createRenderPipelineAsync = function (descriptor) { return original.createRenderPipelineAsync.call(this, renew(descriptor)); };
    return () => Object.assign(device, original);
}
