import type {Object3D} from 'three/webgpu';
import type {VRM} from '@pixiv/three-vrm';

// B43 R10: the only caller of the spring manager. A later flat, WASM, or streamed solver can replace it without a change to the stage.
export type SpringRig = { joints: ReadonlySet<Object3D>; reset(): void; step(seconds: number): void; setScale(scale: number): void };

export function createSpringRig(vrm: VRM): SpringRig | null {
    const manager = vrm.springBoneManager;
    if (!manager || manager.joints.size === 0) return null;
    manager.setInitState();
    // B43 R13: three-vrm scales the bone length with the avatar but reads these values unscaled on each step.
    const joints = [...manager.joints].map(joint => ({ settings: joint.settings, hitRadius: joint.settings.hitRadius, stiffness: joint.settings.stiffness, gravityPower: joint.settings.gravityPower }));
    const shapes = manager.colliders.flatMap(collider => { const shape = collider.shape as { radius?: unknown }; return typeof shape.radius === 'number' ? [{ shape: shape as { radius: number }, radius: shape.radius }] : []; });
    let scale = 1;
    return {
        joints: new Set([...manager.joints].map(joint => joint.bone)),
        reset: () => manager.reset(),
        step: seconds => manager.update(seconds),
        setScale(next) {
            if (next === scale) return;
            scale = next;
            for (const joint of joints) {
                joint.settings.hitRadius = joint.hitRadius * next;
                joint.settings.stiffness = joint.stiffness * next;
                joint.settings.gravityPower = joint.gravityPower * next;
            }
            for (const entry of shapes) entry.shape.radius = entry.radius * next;
        },
    };
}
