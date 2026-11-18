import type {Object3D} from 'three/webgpu';
import {planSpringSteps, SPRING_STEP_SECONDS, type SpringClock} from './spring-grid';
import {applyPose, capturePose, type PoseSample} from './spring-pose';
import type {SpringRig} from './spring-rig';

// B43 R7 to R9, R13: `posed` are the nodes that the pose and the entity transform set (interpolated between frames);
// `held` are humanoid bones that are also spring joints, which keep the last spring result.
export function createSpringStage(rig: SpringRig, root: Object3D, posed: readonly Object3D[], held: readonly Object3D[]) {
    let clock: SpringClock | null = null;
    let previous: PoseSample | null = null;
    let kept = capturePose(held);
    return {
        advance(next: SpringClock) {
            const current = capturePose(posed);
            const plan = planSpringSteps(clock, next);
            if (plan.reset) { rig.reset(); previous = null; }
            rig.setScale((Math.abs(root.scale.x) + Math.abs(root.scale.y) + Math.abs(root.scale.z)) / 3);
            for (const fraction of plan.fractions) {
                applyPose(posed, previous ?? current, current, fraction);
                root.updateMatrixWorld(true);
                rig.step(SPRING_STEP_SECONDS);
            }
            if (plan.fractions.length) { applyPose(posed, current, current, 1); root.updateMatrixWorld(true); }
            if (plan.reset || plan.fractions.length) kept = capturePose(held);
            else if (held.length) { applyPose(held, kept, kept, 1); root.updateMatrixWorld(true); }
            previous = current;
            clock = next;
        },
    };
}
