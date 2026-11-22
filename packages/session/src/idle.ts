import type {AssetAnimation,IdleBone,Quat} from '@opensekai/contracts';
const radians = Math.PI / 180;
/** Degrees from T-pose toward the sides so hands hang near the thighs. */
const armDropDeg = 76;
/** Slight forward hang so hands clear a flared skirt. */
const armForwardDeg = 10;
/** Soft elbow flex on local X. */
const elbowFlexDeg = 14;
function phase(elapsedMs:number,periodMs:number):number {
    return elapsedMs % periodMs / periodMs * 2 * Math.PI;
}
function axisAngle(axis:'x'|'z',halfAngle:number,sign=1):Quat {
    const s = Math.sin(halfAngle) * sign;
    const c = Math.cos(halfAngle);
    return axis === 'x' ? [s, 0, 0, c] : [0, 0, s, c];
}
function mul(a:Quat,b:Quat):Quat {
    const [ax,ay,az,aw] = a,[bx,by,bz,bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}
function upperArm(side:'left'|'right'):Quat {
    const drop = axisAngle('z', armDropDeg * radians / 2, side === 'left' ? -1 : 1);
    const forward = axisAngle('x', armForwardDeg * radians / 2);
    return mul(drop, forward);
}
export function evaluateAvatarIdle(elapsedMs:number):Record<string,IdleBone> {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new RangeError('Animation time must be finite and nonnegative');
    }
    const pitchHalf = Math.sin(phase(elapsedMs,6000)) * .6 * radians / 2;
    const rollHalf = Math.sin(phase(elapsedMs,8000)) * .4 * radians / 2;
    // Compose pitch and roll without a growing phase or renderer-local clock.
    const chest:Quat = [
        Math.sin(pitchHalf) * Math.cos(rollHalf),
        -Math.sin(pitchHalf) * Math.sin(rollHalf),
        Math.cos(pitchHalf) * Math.sin(rollHalf),
        Math.cos(pitchHalf) * Math.cos(rollHalf),
    ];
    const elbow = axisAngle('x', elbowFlexDeg * radians / 2);
    return {
        leftUpperArm: {space:'normalized',rotation:upperArm('left')},
        rightUpperArm: {space:'normalized',rotation:upperArm('right')},
        leftLowerArm: {space:'normalized',rotation:elbow},
        rightLowerArm: {space:'normalized',rotation:elbow},
        chest: {space:'normalized',rotation:chest},
    };
}
function readQuat(values:readonly number[],index:number):Quat {
    const o = index * 4;
    return [values[o]!, values[o + 1]!, values[o + 2]!, values[o + 3]!];
}
function slerp(a:Quat,b:Quat,t:number):Quat {
    let [ax,ay,az,aw] = a,[bx,by,bz,bw] = b;
    let dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
    if (dot > 0.9995) {
        const q:Quat = [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az), aw + t * (bw - aw)];
        const length = Math.hypot(...q);
        return q.map(value => value / length) as Quat;
    }
    const theta = Math.acos(Math.min(1, dot));
    const sin = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    return [ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb];
}
function sampleTrack(times:readonly number[],rotations:readonly number[],timeSec:number):Quat {
    const last = times.length - 1;
    if (timeSec <= times[0]!) return readQuat(rotations, 0);
    if (timeSec >= times[last]!) return readQuat(rotations, last);
    let hi = last;
    for (let i = 1; i <= last; i++) if (times[i]! >= timeSec) { hi = i; break; }
    const lo = hi - 1;
    const t0 = times[lo]!, t1 = times[hi]!;
    const u = t1 === t0 ? 0 : (timeSec - t0) / (t1 - t0);
    return slerp(readQuat(rotations, lo), readQuat(rotations, hi), u);
}
export function evaluateAvatarClipIdle(animation:AssetAnimation,elapsedMs:number):Record<string,IdleBone> {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        throw new RangeError('Animation time must be finite and nonnegative');
    }
    const duration = animation.durationMs;
    const timeSec = (elapsedMs % duration) / 1000;
    const bones:Record<string,IdleBone> = {};
    for (const [name, track] of Object.entries(animation.bones)) {
        bones[name] = { space: 'normalized', rotation: sampleTrack(track.times, track.rotations, timeSec) };
    }
    return bones;
}
