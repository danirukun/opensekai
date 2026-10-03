import type { Quat, Transform } from "@opensekai/contracts";
export function markerRotation(elapsedMs: number): Quat {
    const halfAngle = (elapsedMs / 1000) * Math.PI / 4;
    return [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
}
export function evaluateSmokeTransform(id: string, base: Transform, elapsedMs: number): Transform {
    const transform = structuredClone(base);
    if (id === "marker") {
        const [ax, ay, az, aw] = base.rotation;
        const [, by, , bw] = markerRotation(elapsedMs);
        transform.rotation = [ax * bw - az * by, aw * by + ay * bw, ax * by + az * bw, aw * bw - ay * by];
    }
    else if (id === "performer") {
        transform.position[0] += 0.08 * Math.sin(elapsedMs / 1000);
        transform.position[1] += 0.02 * Math.sin(elapsedMs / 500);
    }
    return transform;
}
