import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { rendererBuild } from '../../packages/renderer/vite-build.ts';
export default defineConfig({ plugins: [tailwindcss(), svelte({ preprocess: vitePreprocess() })], clearScreen: false, server: { host: '127.0.0.1', port: 1420, strictPort: true }, base: './', build: rendererBuild,
 // rete-svelte-plugin presets use Sass @import and old built-ins; OpenSekai has no Sass of its own.
 css: { preprocessorOptions: { scss: { silenceDeprecations: ['import', 'global-builtin', 'color-functions'] } } } });
