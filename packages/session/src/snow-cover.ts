import type { SceneEntity, SceneView, SnowCover, SnowSettings } from '@opensekai/contracts';

// Snow cover R1: the one cover value of the snow entity. Never saved; the session puts it on each frame.
export type SnowCoverState = SnowCover | null;

// Snow cover R2.
export const coverStep = (cover: number, { rate, buildUpSeconds, meltSeconds }: Pick<SnowSettings, 'rate' | 'buildUpSeconds' | 'meltSeconds'>, seconds: number): number =>
    Math.min(1, Math.max(0, cover + seconds * (rate > 0 ? rate / buildUpSeconds : -1 / meltSeconds)));

// Snow cover R3: `scene` is the evaluated scene. A hidden snow has cover 0, and a new id starts at 0 without a step.
export const advanceSnowCover = (state: SnowCoverState, scene: SceneView, seconds: number): SnowCoverState => {
    const entity = scene.entities.find((item): item is Extract<SceneEntity, { kind: 'snow' }> => item.kind === 'snow');
    if (!entity) return null;
    const cover = !entity.visible || state?.entityId !== entity.id ? 0 : coverStep(state.cover, entity.snow, seconds);
    return { entityId: entity.id, cover };
};
