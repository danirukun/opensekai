// A WebGPU render pipeline that fails to compile (for example, a Metal limit in the WGSL translation) stops later frames.
// This watch records the WGSL of each shader module and reports the failing pipeline with its shaders, once for each
// distinct shader pair. Structural types: the workspace has no WebGPU type package.
type ShaderModule = object;
interface ShaderStage { module: ShaderModule; entryPoint?: string }
interface PipelineDescriptor { label?: string; vertex: ShaderStage; fragment?: ShaderStage }
interface ErrorLike { message: string }
export interface PipelineDevice {
    createShaderModule(descriptor: { code: string; label?: string }): ShaderModule;
    createRenderPipeline(descriptor: PipelineDescriptor): unknown;
    createRenderPipelineAsync(descriptor: PipelineDescriptor): Promise<unknown>;
    pushErrorScope(filter: "validation" | "internal" | "out-of-memory"): void;
    popErrorScope(): Promise<ErrorLike | null>;
}
export interface PipelineFailure { message: string; label: string | null; vertex: string | null; fragment: string | null; maxNesting: number }

export const MAX_REPORTED_FAILURES = 16;
// The deepest bracket nesting of a shader source: the Metal translation limit that the owner saw is 256.
export function bracketNesting(code: string): number {
    let depth = 0, max = 0;
    for (const char of code) {
        if (char === "(" || char === "[" || char === "{") max = Math.max(max, ++depth);
        else if (char === ")" || char === "]" || char === "}") depth--;
    }
    return max;
}

/** Wraps the pipeline and shader methods of `device`. Returns a function that restores them. */
export function watchPipelineErrors(device: PipelineDevice, report: (failure: PipelineFailure, first: boolean) => void): () => void {
    const sources = new WeakMap<ShaderModule, string>();
    const reported = new Set<string>();
    const original = { createShaderModule: device.createShaderModule, createRenderPipeline: device.createRenderPipeline, createRenderPipelineAsync: device.createRenderPipelineAsync };
    const fail = (descriptor: PipelineDescriptor, error: ErrorLike) => {
        const vertex = sources.get(descriptor.vertex.module) ?? null, fragment = descriptor.fragment ? sources.get(descriptor.fragment.module) ?? null : null;
        const key = `${vertex}\u0000${fragment}`;
        const first = !reported.has(key) && reported.size < MAX_REPORTED_FAILURES;
        if (first) reported.add(key);
        report({ message: error.message, label: descriptor.label ?? null, vertex, fragment, maxNesting: Math.max(bracketNesting(vertex ?? ""), bracketNesting(fragment ?? "")) }, first);
    };
    device.createShaderModule = function (descriptor) {
        const module = original.createShaderModule.call(this, descriptor);
        sources.set(module, descriptor.code);
        return module;
    };
    device.createRenderPipeline = function (descriptor) {
        this.pushErrorScope("internal");
        this.pushErrorScope("validation");
        const pipeline = original.createRenderPipeline.call(this, descriptor);
        void Promise.all([this.popErrorScope(), this.popErrorScope()]).then(errors => { for (const error of errors) if (error) fail(descriptor, error); }, () => undefined);
        return pipeline;
    };
    device.createRenderPipelineAsync = function (descriptor) {
        return original.createRenderPipelineAsync.call(this, descriptor).catch((error: ErrorLike) => { fail(descriptor, error); throw error; });
    };
    return () => Object.assign(device, original);
}

/** Logs a failure for the owner: one summary line, then each shader source. */
export function logPipelineFailure(failure: PipelineFailure) {
    console.error("Pipeline compile failed", JSON.stringify({ message: failure.message.slice(0, 2000), label: failure.label, maxNesting: failure.maxNesting, vertexLength: failure.vertex?.length ?? null, fragmentLength: failure.fragment?.length ?? null }));
    // A Metal compiler message carries the generated source before its error line, so a long message is logged in full.
    if (failure.message.length > 2000) console.error("Failed pipeline message\n" + failure.message);
    if (failure.vertex) console.error("Failed pipeline vertex WGSL\n" + failure.vertex);
    if (failure.fragment) console.error("Failed pipeline fragment WGSL\n" + failure.fragment);
}
