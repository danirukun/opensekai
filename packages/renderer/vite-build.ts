import type { BuildEnvironmentOptions } from 'vite';
// Shared build settings for the bundles that embed the renderer (desktop app and OBS output).
// The bundles load from local disk or loopback, and three.js WebGPU alone is about 1 MB, so the default 500 kB chunk warning does not apply.
// three-vrm 3.5.5 keeps a `tslFn` branch for three.js before r168; with three.js r180 that branch never runs.
export const rendererBuild: BuildEnvironmentOptions = {
    chunkSizeWarningLimit: 2048,
    rolldownOptions: {
        onLog(level, log, handler) {
            if (log.code === 'IMPORT_IS_UNDEFINED' && log.message.includes('tslFn') && log.message.includes('@pixiv/three-vrm')) return;
            handler(level, log);
        },
    },
};
