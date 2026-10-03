import type {IdleBone,Quat} from '@opensekai/contracts';
const radians = Math.PI / 180;
const armHalfAngle = 55 * radians / 2;
function phase(elapsedMs:number,periodMs:number):number {
    return elapsedMs % periodMs / periodMs * 2 * Math.PI;
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
    return {
        leftUpperArm: {space:'normalized',rotation:[0,0,-Math.sin(armHalfAngle),Math.cos(armHalfAngle)]},
        rightUpperArm: {space:'normalized',rotation:[0,0,Math.sin(armHalfAngle),Math.cos(armHalfAngle)]},
        chest: {space:'normalized',rotation:chest},
    };
}
