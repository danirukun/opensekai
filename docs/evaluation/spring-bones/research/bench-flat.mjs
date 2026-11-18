// Research prototype: flat typed-array spring solver vs three-vrm 3.5.5 on the same skeleton-only VRMs.
// Throwaway. Assumes uniform scale, no center space, sphere and capsule colliders.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMHumanoidLoaderPlugin, VRMSpringBoneLoaderPlugin } from '@pixiv/three-vrm';

function glbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}
function skeletonOnly(json) {
  const out = { asset: json.asset, scene: json.scene ?? 0, scenes: json.scenes, nodes: json.nodes.map(({ mesh, skin, camera, ...n }) => n), extensionsUsed: (json.extensionsUsed ?? []).filter(e => e.startsWith('VRM')), extensions: {} };
  for (const k of ['VRM', 'VRMC_vrm', 'VRMC_springBone', 'VRMC_springBone_extended_collider']) if (json.extensions?.[k]) out.extensions[k] = json.extensions[k];
  return out;
}
async function load(path) {
  const loader = new GLTFLoader();
  loader.register(p => new VRMHumanoidLoaderPlugin(p));
  loader.register(p => new VRMSpringBoneLoaderPlugin(p));
  const gltf = await loader.parseAsync(JSON.stringify(skeletonOnly(glbJson(readFileSync(path)))), '');
  return gltf;
}

// Build flat arrays from the three-vrm joint list (same model data for both solvers).
function compile(manager) {
  manager.setInitState();
  const sorted = manager._sortedJoints;
  const n = sorted.length;
  const index = new Map(sorted.map((j, i) => [j.bone, i]));
  const anchors = [], anchorIndex = new Map();
  const parent = new Int32Array(n), anchor = new Int32Array(n);
  const localPos = new Float64Array(n * 3), initRot = new Float64Array(n * 4), axis = new Float64Array(n * 3), tailLen = new Float64Array(n);
  const stiff = new Float64Array(n), drag = new Float64Array(n), gpow = new Float64Array(n), gdir = new Float64Array(n * 3), hit = new Float64Array(n);
  const colliders = [], colliderIndex = new Map();
  const colStart = new Int32Array(n), colCount = new Int32Array(n), colList = [];
  sorted.forEach((j, i) => {
    const p = index.get(j.bone.parent);
    parent[i] = p ?? -1;
    if (p === undefined) { if (!anchorIndex.has(j.bone.parent)) { anchorIndex.set(j.bone.parent, anchors.length); anchors.push(j.bone.parent); } anchor[i] = anchorIndex.get(j.bone.parent); }
    localPos.set(j.bone.position.toArray(), i * 3);
    initRot.set(j._initialLocalRotation.toArray(), i * 4);
    axis.set(j._boneAxis.toArray(), i * 3);
    tailLen[i] = j._initialLocalChildPosition.length();
    stiff[i] = j.settings.stiffness; drag[i] = j.settings.dragForce; gpow[i] = j.settings.gravityPower; hit[i] = j.settings.hitRadius;
    gdir.set(j.settings.gravityDir.toArray(), i * 3);
    colStart[i] = colList.length;
    for (const g of j.colliderGroups) for (const c of g.colliders) {
      if (!colliderIndex.has(c)) { colliderIndex.set(c, colliders.length); colliders.push(c); }
      colList.push(colliderIndex.get(c));
    }
    colCount[i] = colList.length - colStart[i];
  });
  const nc = colliders.length;
  const cKind = new Uint8Array(nc), cOff = new Float64Array(nc * 3), cTail = new Float64Array(nc * 3), cRad = new Float64Array(nc);
  colliders.forEach((c, k) => {
    const s = c.shape; cKind[k] = s.type === 'capsule' ? 1 : 0;
    cOff.set(s.offset.toArray(), k * 3); if (s.tail) cTail.set(s.tail.toArray(), k * 3); cRad[k] = s.radius;
  });
  // State (world space): current and previous tails, joint world pose.
  const cur = new Float64Array(n * 3), prev = new Float64Array(n * 3);
  sorted.forEach((j, i) => { cur.set(j._currentTail.toArray(), i * 3); prev.set(j._prevTail.toArray(), i * 3); });
  return { n, sorted, anchors, colliders, parent, anchor, localPos, initRot, axis, tailLen, stiff, drag, gpow, gdir, hit, colStart, colCount, colList: Int32Array.from(colList),
    nc, cKind, cOff, cTail, cRad, cur, prev, wPos: new Float64Array(n * 3), wRot: new Float64Array(n * 4), wScale: new Float64Array(n), outRot: new Float64Array(n * 4),
    aPos: new Float64Array(anchors.length * 3), aRot: new Float64Array(anchors.length * 4), aScale: new Float64Array(anchors.length),
    cA: new Float64Array(nc * 3), cB: new Float64Array(nc * 3), cR: new Float64Array(nc) };
}

// Quaternion helpers on arrays (x,y,z,w).
function qmul(a, ai, b, bi, o, oi) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3], bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  o[oi] = aw * bx + ax * bw + ay * bz - az * by; o[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[oi + 2] = aw * bz + ax * by - ay * bx + az * bw; o[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
const tv = new Float64Array(3);
function qrot(q, qi, x, y, z, o) { // o = q * v
  const qx = q[qi], qy = q[qi + 1], qz = q[qi + 2], qw = q[qi + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[0] = x + qw * tx + qy * tz - qz * ty; o[1] = y + qw * ty + qz * tx - qx * tz; o[2] = z + qw * tz + qx * ty - qy * tx;
}
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const tmpQ = new Float64Array(4), rest = new Float64Array(4), delta = new Float64Array(4);

function step(f, dt) {
  // Read anchors and colliders from the posed skeleton (world matrices already updated).
  for (let a = 0; a < f.anchors.length; a++) {
    f.anchors[a].matrixWorld.decompose(_p, _q, _s);
    f.aPos[a * 3] = _p.x; f.aPos[a * 3 + 1] = _p.y; f.aPos[a * 3 + 2] = _p.z;
    f.aRot[a * 4] = _q.x; f.aRot[a * 4 + 1] = _q.y; f.aRot[a * 4 + 2] = _q.z; f.aRot[a * 4 + 3] = _q.w; f.aScale[a] = _s.x;
  }
  for (let k = 0; k < f.nc; k++) {
    const m = f.colliders[k].matrixWorld.elements, s = Math.hypot(m[0], m[1], m[2]);
    const ox = f.cOff[k * 3], oy = f.cOff[k * 3 + 1], oz = f.cOff[k * 3 + 2];
    f.cA[k * 3] = m[0] * ox + m[4] * oy + m[8] * oz + m[12]; f.cA[k * 3 + 1] = m[1] * ox + m[5] * oy + m[9] * oz + m[13]; f.cA[k * 3 + 2] = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
    const tx = f.cTail[k * 3], ty = f.cTail[k * 3 + 1], tz = f.cTail[k * 3 + 2];
    f.cB[k * 3] = m[0] * tx + m[4] * ty + m[8] * tz + m[12]; f.cB[k * 3 + 1] = m[1] * tx + m[5] * ty + m[9] * tz + m[13]; f.cB[k * 3 + 2] = m[2] * tx + m[6] * ty + m[10] * tz + m[14];
    f.cR[k] = f.cRad[k] * s;
  }
  const { n, parent, anchor, localPos, initRot, axis, tailLen, stiff, drag, gpow, gdir, hit, colStart, colCount, colList, cKind, cA, cB, cR, cur, prev, wPos, wRot, wScale, outRot } = f;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3, i4 = i * 4, p = parent[i];
    const PP = p >= 0 ? wPos : f.aPos, PR = p >= 0 ? wRot : f.aRot, pi = p >= 0 ? p : anchor[i];
    const s = p >= 0 ? wScale[p] : f.aScale[pi];
    // Joint world position = parent * localPos.
    qrot(PR, pi * 4, localPos[i3] * s, localPos[i3 + 1] * s, localPos[i3 + 2] * s, tv);
    const jx = PP[pi * 3] + tv[0], jy = PP[pi * 3 + 1] + tv[1], jz = PP[pi * 3 + 2] + tv[2];
    // Rest world rotation = parent rotation * initial local rotation.
    qmul(PR, pi * 4, initRot, i4, rest, 0);
    qrot(rest, 0, axis[i3], axis[i3 + 1], axis[i3 + 2], tv);
    const len = tailLen[i] * s, k1 = 1 - drag[i], st = stiff[i] * dt, gp = gpow[i] * dt;
    const cx = cur[i3], cy = cur[i3 + 1], cz = cur[i3 + 2];
    let nx = cx + (cx - prev[i3]) * k1 + tv[0] * st + gdir[i3] * gp;
    let ny = cy + (cy - prev[i3 + 1]) * k1 + tv[1] * st + gdir[i3 + 1] * gp;
    let nz = cz + (cz - prev[i3 + 2]) * k1 + tv[2] * st + gdir[i3 + 2] * gp;
    let dx = nx - jx, dy = ny - jy, dz = nz - jz, l = Math.hypot(dx, dy, dz) || 1;
    nx = jx + dx / l * len; ny = jy + dy / l * len; nz = jz + dz / l * len;
    const hr = hit[i];
    for (let c = colStart[i], e = c + colCount[i]; c < e; c++) {
      const k = colList[c], k3 = k * 3;
      let ax = cA[k3], ay = cA[k3 + 1], az = cA[k3 + 2];
      if (cKind[k] === 1) { // closest point on the capsule segment
        const bx = cB[k3] - ax, by = cB[k3 + 1] - ay, bz = cB[k3 + 2] - az, bb = bx * bx + by * by + bz * bz;
        const t = bb > 0 ? Math.min(1, Math.max(0, ((nx - ax) * bx + (ny - ay) * by + (nz - az) * bz) / bb)) : 0;
        ax += bx * t; ay += by * t; az += bz * t;
      }
      dx = nx - ax; dy = ny - ay; dz = nz - az;
      const d = Math.hypot(dx, dy, dz), r = cR[k] + hr;
      if (d < r && d > 0) {
        nx = ax + dx / d * r; ny = ay + dy / d * r; nz = az + dz / d * r;
        dx = nx - jx; dy = ny - jy; dz = nz - jz; l = Math.hypot(dx, dy, dz) || 1;
        nx = jx + dx / l * len; ny = jy + dy / l * len; nz = jz + dz / l * len;
      }
    }
    prev[i3] = cx; prev[i3 + 1] = cy; prev[i3 + 2] = cz; cur[i3] = nx; cur[i3 + 1] = ny; cur[i3 + 2] = nz;
    // Local direction of the tail in the rest frame, then rotation from the bone axis to it.
    tmpQ[0] = -rest[0]; tmpQ[1] = -rest[1]; tmpQ[2] = -rest[2]; tmpQ[3] = rest[3];
    dx = nx - jx; dy = ny - jy; dz = nz - jz; l = Math.hypot(dx, dy, dz) || 1;
    qrot(tmpQ, 0, dx / l, dy / l, dz / l, tv);
    const ux = axis[i3], uy = axis[i3 + 1], uz = axis[i3 + 2];
    let w = ux * tv[0] + uy * tv[1] + uz * tv[2] + 1;
    delta[0] = uy * tv[2] - uz * tv[1]; delta[1] = uz * tv[0] - ux * tv[2]; delta[2] = ux * tv[1] - uy * tv[0]; delta[3] = w;
    const dl = Math.hypot(delta[0], delta[1], delta[2], delta[3]) || 1;
    delta[0] /= dl; delta[1] /= dl; delta[2] /= dl; delta[3] /= dl;
    qmul(initRot, i4, delta, 0, outRot, i4);
    qmul(PR, pi * 4, outRot, i4, wRot, i4);
    wPos[i3] = jx; wPos[i3 + 1] = jy; wPos[i3 + 2] = jz; wScale[i] = s;
  }
}

const gltfs = [];
for (const path of process.argv.slice(2)) gltfs.push(await load(path));
const flats = gltfs.map(g => compile(g.userData.vrmSpringBoneManager));
if (process.env.EXACT) for (const g of gltfs) for (const j of g.userData.vrmSpringBoneManager.joints) j._calcWorldSpaceBoneLength = function () { this._worldSpaceBoneLength = this._initialLocalChildPosition.length(); };
const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
function pose(g, t) {
  g.scene.position.set(Math.sin(t * 2) * 0.3, 0, 0);
  g.userData.vrmHumanoid.getNormalizedBoneNode('head')?.quaternion.copy(q.setFromAxisAngle(up, Math.sin(t * 3) * 0.6));
  g.userData.vrmHumanoid.update();
  g.scene.updateMatrixWorld(true);
}
// Correctness: run both solvers side by side for 600 steps and compare the local rotations.
for (let k = 0; k < gltfs.length; k++) {
  const g = gltfs[k], f = flats[k];
  let worst = 0; const per = new Array(f.n).fill(0); const seen = new Set(), dup = new Set(); for (const j of f.sorted) { if (seen.has(j.bone)) dup.add(j.bone); seen.add(j.bone); }
  for (let i = 0; i < 600; i++) {
    pose(g, i / 60);
    step(f, 1 / 60);
    g.userData.vrmSpringBoneManager.update(1 / 60);
    if (i > 10) f.sorted.forEach((j, n) => { if (dup.has(j.bone)) return; const e = j.bone.quaternion.angleTo(new THREE.Quaternion().fromArray(f.outRot, n * 4)); per[n] = Math.max(per[n], e); worst = Math.max(worst, e); });
  }
  const top = [...per.keys()].sort((a, b) => per[b] - per[a]).slice(0, 4).map(n => { const j = f.sorted[n]; return `${j.bone.name}(${(per[n]*180/Math.PI).toFixed(1)}deg parentJoint=${f.parent[n] >= 0} kids=${j.bone.children.length} child=${j.child?.name ?? 'virtual'} cols=${f.colCount[n]})`; });
  const errs = per.filter((e, n) => !dup.has(f.sorted[n].bone)).sort((a, b) => a - b);
  console.log(`flat vs three-vrm: max ${(worst * 180 / Math.PI).toFixed(3)} deg, median ${(errs[errs.length >> 1] * 180 / Math.PI).toFixed(4)} deg (${f.n} joints, ${dup.size} duplicated bones skipped)\n   worst: ${top.join('\n          ')}`);
}
// Speed: all avatars together, solver only.
const times = [];
for (let i = 0; i < 4000; i++) {
  for (const g of gltfs) pose(g, i / 60);
  const t0 = performance.now();
  for (const f of flats) step(f, 1 / 60);
  times.push(performance.now() - t0);
}
times.splice(0, 1000); times.sort((a, b) => a - b);
console.log(`flat solver, ${gltfs.length} avatars together: mean=${(times.reduce((a, b) => a + b) / times.length).toFixed(3)}ms p50=${times[times.length >> 1].toFixed(3)} p99=${times[Math.floor(times.length * .99)].toFixed(3)}`);
