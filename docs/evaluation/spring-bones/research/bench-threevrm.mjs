// Research benchmark: cost of three-vrm 3.5.5 spring bone update on skeleton-only VRMs.
// Usage: node bench-threevrm.mjs <file.vrm>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoidLoaderPlugin, VRMSpringBoneLoaderPlugin } from '@pixiv/three-vrm';

function glbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

// Keep only the node tree and the VRM extensions; three-vrm humanoid and spring loaders need nothing else.
function skeletonOnly(json) {
  const out = { asset: json.asset, scene: json.scene ?? 0, scenes: json.scenes, nodes: json.nodes.map(({ mesh, skin, camera, ...node }) => node), extensionsUsed: (json.extensionsUsed ?? []).filter(e => e.startsWith('VRM')), extensions: {} };
  for (const key of ['VRM', 'VRMC_vrm', 'VRMC_springBone', 'VRMC_springBone_extended_collider']) if (json.extensions?.[key]) out.extensions[key] = json.extensions[key];
  return out;
}

async function load(path) {
  const json = skeletonOnly(glbJson(readFileSync(path)));
  const loader = new GLTFLoader();
  loader.register(parser => new VRMHumanoidLoaderPlugin(parser));
  loader.register(parser => new VRMSpringBoneLoaderPlugin(parser));
  const gltf = await loader.parseAsync(JSON.stringify(json), '');
  return { gltf, name: json.extensions.VRM?.meta?.title ?? json.extensions.VRMC_vrm?.meta?.name ?? basename(path) };
}

function bench(avatars, steps) {
  const roots = avatars.map(a => a.gltf.scene);
  const humanoids = avatars.map(a => a.gltf.userData.vrmHumanoid);
  const managers = avatars.map(a => a.gltf.userData.vrmSpringBoneManager);
  for (const m of managers) m?.setInitState();
  const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0);
  const times = [];
  for (let i = 0; i < steps; i++) {
    const t = i / 60;
    for (let k = 0; k < avatars.length; k++) {
      // Move the root and turn the head so tails and colliders do work.
      roots[k].position.set(Math.sin(t * 2) * 0.3, 0, 0);
      const head = humanoids[k]?.getNormalizedBoneNode('head');
      head?.quaternion.copy(q.setFromAxisAngle(axis, Math.sin(t * 3) * 0.6));
      humanoids[k]?.update();
      roots[k].updateMatrixWorld(true);
    }
    const start = performance.now();
    for (const m of managers) m?.update(1 / 60);
    times.push(performance.now() - start);
  }
  times.splice(0, Math.floor(steps / 4)); // drop warm-up
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { mean, p50: times[Math.floor(times.length / 2)], p99: times[Math.floor(times.length * 0.99)] };
}

const avatars = [];
for (const path of process.argv.slice(2)) avatars.push(await load(path));
for (const a of avatars) {
  const joints = a.gltf.userData.vrmSpringBoneManager?.joints.size ?? 0;
  const colliders = a.gltf.userData.vrmSpringBoneManager?.colliders.length ?? 0;
  const r = bench([a], 4000);
  console.log(`${a.name.slice(0, 26).padEnd(26)} joints=${String(joints).padStart(4)} colliders=${String(colliders).padStart(3)}  mean=${r.mean.toFixed(3)}ms p50=${r.p50.toFixed(3)} p99=${r.p99.toFixed(3)}`);
}
const heavy = avatars.filter(a => /Xiulang|Nina|Nemimi/.test(a.name));
if (heavy.length) {
  const r = bench(heavy, 4000);
  console.log(`3 heavy together (${heavy.map(a => a.name.split(' ')[0]).join(', ')}): mean=${r.mean.toFixed(3)}ms p50=${r.p50.toFixed(3)} p99=${r.p99.toFixed(3)}`);
}
