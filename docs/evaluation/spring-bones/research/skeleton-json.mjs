// Writes json/a0.json, json/a1.json, ... with only the node tree and the VRM extensions of each .vrm.
// Usage: node skeleton-json.mjs <file.vrm>...
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

function glbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

function skeletonOnly(json) {
  const out = { asset: json.asset, scene: json.scene ?? 0, scenes: json.scenes, nodes: json.nodes.map(({ mesh, skin, camera, ...node }) => node), extensionsUsed: (json.extensionsUsed ?? []).filter(e => e.startsWith('VRM')), extensions: {} };
  for (const key of ['VRM', 'VRMC_vrm', 'VRMC_springBone', 'VRMC_springBone_extended_collider']) if (json.extensions?.[key]) out.extensions[key] = json.extensions[key];
  return out;
}

mkdirSync(new URL('./json/', import.meta.url), { recursive: true });
process.argv.slice(2).forEach((path, k) => writeFileSync(new URL(`./json/a${k}.json`, import.meta.url), JSON.stringify(skeletonOnly(glbJson(readFileSync(path))))));
