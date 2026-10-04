import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [tailwindcss(), svelte({ preprocess: vitePreprocess() })], clearScreen: false, server: { host: '127.0.0.1', port: 1420, strictPort: true }, base: './' });
