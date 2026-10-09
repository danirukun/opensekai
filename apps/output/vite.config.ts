import { defineConfig } from "vite";
import { rendererBuild } from "../../packages/renderer/vite-build.ts";
export default defineConfig({base:"./",build:{...rendererBuild,outDir:"dist"}});
