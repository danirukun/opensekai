import { Quaternion } from 'three/webgpu';
import { TransformSchema } from '@opensekai/contracts';
import type { Transform } from '@opensekai/contracts';
export function persistentTransform(base: Transform, start: Transform, end: Transform): Transform {
    for (const value of [base,start,end]) {
        TransformSchema.parse(value);
        if (![...value.position,...value.rotation,...value.scale].every(Number.isFinite) || Math.abs(Math.hypot(...value.rotation)-1)>0.001) throw new Error('Invalid transform');
    }
    const rotation = new Quaternion().fromArray(end.rotation).multiply(new Quaternion().fromArray(start.rotation).invert()).multiply(new Quaternion().fromArray(base.rotation)).normalize();
    return TransformSchema.parse({position:base.position.map((v,i)=>v+end.position[i]!-start.position[i]!),rotation:rotation.toArray(),scale:base.scale.map((v,i)=>v*end.scale[i]!/start.scale[i]!)});
}
