import {Object3D,Quaternion,Vector3} from 'three/webgpu';
import type {VRM, VRMHumanBoneName, VRMPose} from '@pixiv/three-vrm';
import type {AvatarPose} from '@opensekai/contracts';

const aliases: Record<string,string> = {Joy:'happy',Angry:'angry',Sorrow:'sad',Fun:'relaxed',A:'aa',I:'ih',U:'ou',E:'ee',O:'oh',Blink:'blink',Blink_L:'blinkLeft',Blink_R:'blinkRight',eyeBlink_L:'blinkLeft',eyeBlink_R:'blinkRight',eyeBlinkLeft:'blinkLeft',eyeBlinkRight:'blinkRight',jawOpen:'aa',mouthSmile_L:'happy',mouthSmile_R:'happy',mouthSmileLeft:'happy',mouthSmileRight:'happy'};
export function expressionWeights(expressions: Record<string,number>, names: ReadonlySet<string>) {
    const result: Record<string,number> = Object.create(null);
    for (const [name, weight] of Object.entries(expressions)) {
        const target = names.has(name) ? name : (Object.hasOwn(aliases,name) ? aliases[name] : name);
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
    const resolveChest=(normalized:VRMPose) => {
        if (normalized.chest && !vrm.humanoid.getNormalizedBoneNode('chest')) {
            // A chestless humanoid uses the spine to carry the same torso delta.
            const spine=normalized.spine;
            const rotation=new Quaternion().fromArray(spine?.rotation ?? [0,0,0,1]);
            const position=new Vector3().fromArray(normalized.chest.position ?? [0,0,0]).applyQuaternion(rotation)
                .add(new Vector3().fromArray(spine?.position ?? [0,0,0]));
            rotation.multiply(new Quaternion().fromArray(normalized.chest.rotation ?? [0,0,0,1]));
            normalized.spine={rotation:rotation.toArray(),position:position.toArray()};
            delete normalized.chest;
        }
    };
    const names = new Set(vrm.expressionManager?.expressions.map(expression=>expression.expressionName) ?? []);
    return {root, apply(pose?: AvatarPose) {
        // Reset raw state before normalized deltas so lost channels return to rest.
        for (const [node, transform] of rest) {node.position.fromArray(transform.position);node.quaternion.fromArray(transform.rotation);}
        vrm.humanoid.resetNormalizedPose();
        const normalized: VRMPose = {};
        for (const [name,bone] of Object.entries(pose?.baseBones ?? {})) {
            normalized[name as VRMHumanBoneName]={rotation:[...bone.rotation],...(bone.position ? {position:[...bone.position]} : {})};
        }
        resolveChest(normalized);
        for (const [name,bone] of Object.entries(pose?.bones ?? {})) {
            if (bone.space !== 'normalized') continue;
            const weight=bone.weight ?? 1;
            const target=name==='chest' && !vrm.humanoid.getNormalizedBoneNode('chest')
                && pose?.bones.spine?.space!=='normalized' ? 'spine' : name;
            const baseline=normalized[target as VRMHumanBoneName];
            const rotation=new Quaternion().fromArray(baseline?.rotation ?? [0,0,0,1]).slerp(new Quaternion().fromArray(bone.rotation),weight).toArray();
            const position=bone.position ? new Vector3().fromArray(baseline?.position ?? [0,0,0]).lerp(new Vector3().fromArray(bone.position),weight).toArray() : baseline?.position;
            normalized[target as VRMHumanBoneName]={rotation,...(position ? {position} : {})};
        }
        resolveChest(normalized);
        vrm.humanoid.setNormalizedPose(normalized);
        vrm.humanoid.update();
        for (const [name,bone] of Object.entries(pose?.bones ?? {})) {
            if (bone.space !== 'raw') continue;
            const node=vrm.humanoid.getRawBoneNode(name as VRMHumanBoneName);
            const transform=node ? rest.get(node) : undefined;
            if(node && transform) {
                const weight=bone.weight ?? 1;
                if (!pose?.baseBones) {
                    node.quaternion.fromArray(transform.rotation);
                    if(bone.position) node.position.fromArray(transform.position);
                }
                node.quaternion.slerp(new Quaternion().fromArray(bone.rotation),weight);
                if(bone.position) node.position.lerp(new Vector3().fromArray(bone.position),weight);
            }
        }
        motion.position.fromArray(pose?.root?.position ?? [0,0,0]);
        motion.quaternion.fromArray(pose?.root?.rotation ?? [0,0,0,1]);
        const weights=expressionWeights(pose?.expressions ?? {},names);
        for (const name of names) vrm.expressionManager?.setValue(name,weights[name] ?? 0);
        vrm.expressionManager?.update();
        root.updateMatrixWorld(true);
    }};
}
