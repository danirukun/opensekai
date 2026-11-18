import { rotateByQuaternion, type AvatarPose, type Id, type Quat, type SceneEntity, type SceneView, type SpringReset, type Vec3 } from '@opensekai/contracts';
import { multiplyQuat } from './bone-offsets';

// B43 R4: a larger change of an avatar root between two frames is a teleport, and the renderers reset its spring bones.
export const TELEPORT_LIMITS = { metres: 0.1, degrees: 30, scaleRatio: 1.25 } as const;
export type RootSample = { position: Vec3; rotation: Quat; scale: number };
export type SpringResetState = ReadonlyMap<Id, { assetId: Id | null; root: RootSample; count: number }>;

// B43 R3: the entity transform times pose.root; the scale is the mean of the axis scales.
export function avatarRoot(transform: { position: Vec3; rotation: Quat; scale: Vec3 }, root?: AvatarPose['root']): RootSample {
    const { position: [tx, ty, tz], rotation, scale: [sx, sy, sz] } = transform;
    const scale = (Math.abs(sx) + Math.abs(sy) + Math.abs(sz)) / 3;
    if (!root) return { position: [tx, ty, tz], rotation, scale };
    const [px, py, pz] = rotateByQuaternion([sx * root.position[0], sy * root.position[1], sz * root.position[2]], rotation);
    return { position: [tx + px, ty + py, tz + pz], rotation: multiplyQuat(rotation, root.rotation), scale };
}

export function isTeleport(previous: RootSample, current: RootSample): boolean {
    const [ax, ay, az] = previous.position, [bx, by, bz] = current.position;
    const [qx, qy, qz, qw] = previous.rotation, [rx, ry, rz, rw] = current.rotation;
    const degrees = 2 * Math.acos(Math.min(1, Math.abs(qx * rx + qy * ry + qz * rz + qw * rw))) * 180 / Math.PI;
    const ratio = Math.max(previous.scale / current.scale, current.scale / previous.scale);
    return Math.hypot(bx - ax, by - ay, bz - az) > TELEPORT_LIMITS.metres || degrees > TELEPORT_LIMITS.degrees || ratio > TELEPORT_LIMITS.scaleRatio;
}

// B43 R5: a new avatar or a changed asset has nothing to compare; the count never goes back.
export function advanceSpringResets(state: SpringResetState, scene: SceneView, poses: readonly AvatarPose[]): { state: SpringResetState; resets: SpringReset[] } {
    const avatars = scene.entities.filter((entity): entity is Extract<SceneEntity, { kind: 'avatar' }> => entity.kind === 'avatar');
    const next: SpringResetState = new Map(avatars.map(entity => {
        const root = avatarRoot(entity.transform, poses.find(pose => pose.avatarId === entity.id)?.root);
        const previous = state.get(entity.id);
        const teleport = previous !== undefined && previous.assetId === entity.assetId && isTeleport(previous.root, root);
        return [entity.id, { assetId: entity.assetId, root, count: (previous?.count ?? 0) + (teleport ? 1 : 0) }];
    }));
    return { state: next, resets: [...next].filter(([, value]) => value.count > 0).map(([avatarId, { count }]) => ({ avatarId, count })) };
}
