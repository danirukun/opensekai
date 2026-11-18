// Two experiments with stock three-vrm on the same pose stream:
// 1. Convergence: instance B starts with every tail displaced; how long until it matches A?
// 2. Skipped frames: B steps only every Nth tick with dt = N/60 (newest pose); steady-state difference?
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoidLoaderPlugin, VRMSpringBoneLoaderPlugin } from '@pixiv/three-vrm';
async function load(text) { const l = new GLTFLoader(); l.register(p => new VRMHumanoidLoaderPlugin(p)); l.register(p => new VRMSpringBoneLoaderPlugin(p)); return l.parseAsync(text, ''); }
const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(0, 0, 1);
// A lively performance: sway, head turns, a 0.5 m step every 2 s.
function pose(g, i) { const t = i / 60; g.scene.position.set(Math.sin(t * 2) * 0.3 + (Math.floor(t / 2) % 2) * 0.5, 0, 0);
  g.userData.vrmHumanoid.getNormalizedBoneNode('head')?.quaternion.copy(q.setFromAxisAngle(up, Math.sin(t * 3) * 0.6));
  g.userData.vrmHumanoid.getNormalizedBoneNode('spine')?.quaternion.copy(q.setFromAxisAngle(side, Math.sin(t * 1.3) * 0.25));
  g.userData.vrmHumanoid.update(); g.scene.updateMatrixWorld(true); }
const diff = (ja, jb) => { let w = 0; for (let n = 0; n < ja.length; n++) w = Math.max(w, ja[n].bone.quaternion.angleTo(jb[n].bone.quaternion)); return w * 180 / Math.PI; };
const files = process.argv.slice(2);
for (const file of files) {
  const text = readFileSync(file, 'utf8'), name = JSON.parse(text).extensions.VRM?.meta?.title;
  // 1. Convergence
  { const a = await load(text), b = await load(text); const ma = a.userData.vrmSpringBoneManager, mb = b.userData.vrmSpringBoneManager; ma.setInitState(); mb.setInitState();
    for (const j of mb.joints) { j._currentTail.y += 0.05; j._prevTail.x += 0.05; }
    const ja = ma._sortedJoints, jb = mb._sortedJoints; const marks = {};
    for (let i = 0; i < 600; i++) { pose(a, i); pose(b, i); ma.update(1 / 60); mb.update(1 / 60); const d = diff(ja, jb); for (const th of [5, 1, 0.1]) if (marks[th] === undefined && d < th) marks[th] = i; if (d >= 0.1) delete marks[0.1]; }
    console.log(`${name}: displaced start converges below 5deg after ${((marks[5] ?? NaN) / 60).toFixed(2)}s, 1deg after ${((marks[1] ?? NaN) / 60).toFixed(2)}s, stays below 0.1deg from ${((marks[0.1] ?? NaN) / 60).toFixed(2)}s`); }
  // 2. Skipped frames
  for (const every of [2, 4]) { const a = await load(text), b = await load(text); const ma = a.userData.vrmSpringBoneManager, mb = b.userData.vrmSpringBoneManager; ma.setInitState(); mb.setInitState();
    const ja = ma._sortedJoints, jb = mb._sortedJoints; const ds = [];
    for (let i = 1; i <= 1200; i++) { pose(a, i); ma.update(1 / 60); if (i % every === 0) { pose(b, i); mb.update(every / 60); if (i > 300) ds.push(diff(ja, jb)); } }
    ds.sort((x, y) => x - y);
    console.log(`${name}: stepping every ${every} ticks (dt=${every}/60) vs every tick: median ${ds[ds.length >> 1].toFixed(2)}deg, p95 ${ds[Math.floor(ds.length * .95)].toFixed(2)}deg, max ${ds[ds.length - 1].toFixed(2)}deg`); }
}
