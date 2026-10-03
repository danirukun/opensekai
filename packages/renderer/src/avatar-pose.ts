import {Object3D} from 'three/webgpu';
import type {VRM, VRMHumanBoneName} from '@pixiv/three-vrm';
import type {AvatarPose} from '@opensekai/contracts';

const aliases: Record<string,string> = {Joy:'happy',Angry:'angry',Sorrow:'sad',Fun:'relaxed',A:'aa',I:'ih',U:'ou',E:'ee',O:'oh',Blink:'blink',Blink_L:'blinkLeft',Blink_R:'blinkRight',eyeBlink_L:'blinkLeft',eyeBlink_R:'blinkRight',jawOpen:'aa',mouthSmile_L:'happy',mouthSmile_R:'happy'};
export function expressionWeights(expressions: Record<string,number>, names: ReadonlySet<string>) {
    const result: Record<string,number> = {};
    for (const [name, weight] of Object.entries(expressions)) {
        const target = names.has(name) ? name : aliases[name] ?? name;
        if (names.has(target)) result[target] = Math.max(result[target] ?? 0, weight);
    }
    return result;
}
export function createAvatarBinding(vrm: VRM) {
    const root = new Object3D();
    const motion = new Object3D();
    root.add(motion); motion.add(vrm.scene);
    const rest = new Map<Object3D,{position:number[];rotation:number[]}>();
    for (const bone of Object.values(vrm.humanoid.rawHumanBones)) {
        const node = bone.node;
        rest.set(node,{position:node.position.toArray(),rotation:node.quaternion.toArray()});
    }
    const names = new Set(vrm.expressionManager?.expressions.map(expression=>expression.expressionName) ?? []);
    return {root, apply(pose?: AvatarPose) {
        // Reset raw state before normalized deltas so lost channels return to rest.
        for (const [node, transform] of rest) {node.position.fromArray(transform.position);node.quaternion.fromArray(transform.rotation);}
        vrm.humanoid.resetNormalizedPose();
        for (const [name,bone] of Object.entries(pose?.bones ?? {})) {
            if (bone.space !== 'normalized') continue;
            vrm.humanoid.setNormalizedPose({[name]:{rotation:bone.rotation,...(bone.position ? {position:bone.position} : {})}});
        }
        vrm.humanoid.update();
        for (const [name,bone] of Object.entries(pose?.bones ?? {})) {
            if (bone.space !== 'raw') continue;
            const node=vrm.humanoid.getRawBoneNode(name as VRMHumanBoneName);
            if(node) {node.quaternion.fromArray(bone.rotation);if(bone.position) node.position.fromArray(bone.position);}
        }
        motion.position.fromArray(pose?.root?.position ?? [0,0,0]);
        motion.quaternion.fromArray(pose?.root?.rotation ?? [0,0,0,1]);
        const weights=expressionWeights(pose?.expressions ?? {},names);
        for (const name of names) vrm.expressionManager?.setValue(name,weights[name] ?? 0);
        vrm.expressionManager?.update();
        root.updateMatrixWorld(true);
    }};
}
