// Self-sensitivity: two three-vrm instances of the same model, one with 1e-9 m tail perturbation.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoidLoaderPlugin, VRMSpringBoneLoaderPlugin } from '@pixiv/three-vrm';
const json = p => { const b = readFileSync(p), v = new DataView(b.buffer, b.byteOffset); const j = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + v.getUint32(12, true))));
  return { asset: j.asset, scene: j.scene ?? 0, scenes: j.scenes, nodes: j.nodes.map(({ mesh, skin, ...n }) => n), extensionsUsed: (j.extensionsUsed ?? []).filter(e => e.startsWith('VRM')), extensions: { VRM: j.extensions.VRM, VRMC_vrm: j.extensions.VRMC_vrm, VRMC_springBone: j.extensions.VRMC_springBone } }; };
async function load(p) { const l = new GLTFLoader(); l.register(x => new VRMHumanoidLoaderPlugin(x)); l.register(x => new VRMSpringBoneLoaderPlugin(x)); return l.parseAsync(JSON.stringify(json(p)), ''); }
const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
for (const p of process.argv.slice(2)) {
  const a = await load(p), b = await load(p);
  const ma = a.userData.vrmSpringBoneManager, mb = b.userData.vrmSpringBoneManager; ma.setInitState(); mb.setInitState();
  for (const j of mb.joints) j._currentTail.x += 1e-9;
  const ja = [...ma._sortedJoints], jb = [...mb._sortedJoints]; let worst = 0; const errs = new Array(ja.length).fill(0);
  for (let i = 0; i < 600; i++) {
    for (const g of [a, b]) { g.scene.position.set(Math.sin(i / 30) * 0.3, 0, 0); g.userData.vrmHumanoid.getNormalizedBoneNode('head')?.quaternion.copy(q.setFromAxisAngle(up, Math.sin(i / 20) * 0.6)); g.userData.vrmHumanoid.update(); g.scene.updateMatrixWorld(true); }
    ma.update(1 / 60); mb.update(1 / 60);
    ja.forEach((j, n) => { const e = j.bone.quaternion.angleTo(jb[n].bone.quaternion); errs[n] = Math.max(errs[n], e); worst = Math.max(worst, e); });
  }
  errs.sort((x, y) => x - y);
  console.log(`three-vrm vs itself (+1e-9 m): max ${(worst * 180 / Math.PI).toFixed(3)} deg, median ${(errs[errs.length >> 1] * 180 / Math.PI).toFixed(5)} deg`);
}
