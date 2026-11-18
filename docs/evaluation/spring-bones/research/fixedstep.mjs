// A = authority, every 60 Hz tick. B = renderer that receives every Nth tick and runs N fixed 1/60 substeps:
// "hold" uses the newest pose for all substeps; "interp" blends the previous and newest received pose.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoidLoaderPlugin, VRMSpringBoneLoaderPlugin } from '@pixiv/three-vrm';
async function load(text) { const l = new GLTFLoader(); l.register(p => new VRMHumanoidLoaderPlugin(p)); l.register(p => new VRMSpringBoneLoaderPlugin(p)); return l.parseAsync(text, ''); }
const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(0, 0, 1);
// The pose sample a frame carries.
const sample = i => { const t = i / 60; return { x: Math.sin(t * 2) * 0.3 + (Math.floor(t / 2) % 2) * 0.5, head: new THREE.Quaternion().setFromAxisAngle(up, Math.sin(t * 3) * 0.6), spine: new THREE.Quaternion().setFromAxisAngle(side, Math.sin(t * 1.3) * 0.25) }; };
const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, head: a.head.clone().slerp(b.head, k), spine: a.spine.clone().slerp(b.spine, k) });
function apply(g, s) { g.scene.position.set(s.x, 0, 0); const h = g.userData.vrmHumanoid; h.getNormalizedBoneNode('head')?.quaternion.copy(s.head); h.getNormalizedBoneNode('spine')?.quaternion.copy(s.spine); h.update(); g.scene.updateMatrixWorld(true); }
const diff = (ja, jb) => { let w = 0; for (let n = 0; n < ja.length; n++) w = Math.max(w, ja[n].bone.quaternion.angleTo(jb[n].bone.quaternion)); return w * 180 / Math.PI; };
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8'), name = JSON.parse(text).extensions.VRM?.meta?.title;
  for (const every of [2, 4]) for (const mode of ['hold', 'interp']) {
    const a = await load(text), b = await load(text); const ma = a.userData.vrmSpringBoneManager, mb = b.userData.vrmSpringBoneManager; ma.setInitState(); mb.setInitState();
    const ja = ma._sortedJoints, jb = mb._sortedJoints; const ds = []; let last = sample(0);
    for (let i = 1; i <= 1200; i++) {
      apply(a, sample(i)); ma.update(1 / 60);
      if (i % every === 0) { const now = sample(i);
        for (let k = 1; k <= every; k++) { apply(b, mode === 'hold' ? now : mix(last, now, k / every)); mb.update(1 / 60); }
        last = now; if (i > 300) ds.push(diff(ja, jb)); }
    }
    ds.sort((x, y) => x - y);
    console.log(`${name.slice(0, 16).padEnd(16)} receives 1/${every} frames, fixed 1/60 substeps, ${mode.padEnd(6)}: median ${ds[ds.length >> 1].toFixed(2)}deg p95 ${ds[Math.floor(ds.length * .95)].toFixed(2)}deg max ${ds[ds.length - 1].toFixed(2)}deg`);
  }
}
