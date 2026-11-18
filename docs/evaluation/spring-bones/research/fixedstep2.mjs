// A = authority, every 60 Hz tick. B = renderer that receives every Nth tick and runs N fixed 1/60 substeps:
// "naive" runs one step with dt = N/60 on the newest pose (no fixed grid);
// "hold" uses the newest pose for all substeps; "interp" blends the previous and newest received pose.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoidLoaderPlugin, VRMSpringBoneLoaderPlugin } from '@pixiv/three-vrm';
async function load(text) { const l = new GLTFLoader(); l.register(p => new VRMHumanoidLoaderPlugin(p)); l.register(p => new VRMSpringBoneLoaderPlugin(p)); return l.parseAsync(text, ''); }
const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(0, 0, 1);
// The pose sample a frame carries.
const sample = i => { const t = i / 60; return { x: Math.sin(t * 2) * 0.3 + Math.sin(t * 0.7) * 0.4, head: new THREE.Quaternion().setFromAxisAngle(up, Math.sin(t * 3) * 0.6), spine: new THREE.Quaternion().setFromAxisAngle(side, Math.sin(t * 1.3) * 0.25) }; };
const mix = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, head: a.head.clone().slerp(b.head, k), spine: a.spine.clone().slerp(b.spine, k) });
function apply(g, s) { g.scene.position.set(s.x, 0, 0); const h = g.userData.vrmHumanoid; h.getNormalizedBoneNode('head')?.quaternion.copy(s.head); h.getNormalizedBoneNode('spine')?.quaternion.copy(s.spine); h.update(); g.scene.updateMatrixWorld(true); }
const diff = (ja, jb) => { let w = 0, m = 0; for (let n = 0; n < ja.length; n++) { const e = ja[n].bone.quaternion.angleTo(jb[n].bone.quaternion); w = Math.max(w, e); m += e; } return [m / ja.length * 180 / Math.PI, w * 180 / Math.PI]; };
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8'), name = JSON.parse(text).extensions.VRM?.meta?.title;
  for (const every of [1, 2, 4]) for (const mode of (every === 1 ? ['exact'] : ['naive', 'hold', 'interp'])) {
    const a = await load(text), b = await load(text); const ma = a.userData.vrmSpringBoneManager, mb = b.userData.vrmSpringBoneManager; ma.setInitState(); mb.setInitState();
    const ja = ma._sortedJoints, jb = mb._sortedJoints; const ds = []; let last = sample(0);
    for (let i = 1; i <= 1200; i++) {
      apply(a, sample(i)); ma.update(1 / 60);
      if (i % every === 0) { const now = sample(i);
        if (mode === 'naive') { apply(b, now); mb.update(every / 60); }
        else for (let k = 1; k <= every; k++) { apply(b, mode === 'hold' ? now : mix(last, now, k / every)); mb.update(1 / 60); }
        last = now; if (i > 300) ds.push(diff(ja, jb)); }
    }
    const mean = ds.map(d => d[0]).sort((x, y) => x - y), worst = ds.map(d => d[1]).sort((x, y) => x - y);
    console.log(`${name.slice(0, 16).padEnd(16)} 1/${every} frames ${mode.padEnd(6)}: mean-over-joints median ${mean[mean.length >> 1].toFixed(2)}deg p95 ${mean[Math.floor(mean.length * .95)].toFixed(2)}deg | worst joint median ${worst[worst.length >> 1].toFixed(2)}deg p95 ${worst[Math.floor(worst.length * .95)].toFixed(2)}deg`);
  }
}
