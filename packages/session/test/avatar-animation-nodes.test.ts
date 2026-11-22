import {describe, expect, it} from 'vitest';
import {makeSmokeScene, nodeDefinition, poseHotkeysTemplate, BlueprintGraphSchema} from '@opensekai/contracts';
import {applyEffects} from '../src/scene-ops';
import {compileBlueprint, runFlow} from '../src/blueprint';
import {emptyState, NO_ENV} from '../src/blueprint-eval';

const at = {x: 0, y: 0};
const node = (id: string, type: string, settings: object = {}) => ({id, version: 1, type, settings, position: at});
const wire = (id: string, from: string, fromPort: string, to: string, toPort: string) =>
  ({id, sourceNodeId: from, sourcePort: fromPort, targetNodeId: to, targetPort: toPort});

describe('avatar animation Blueprint nodes', () => {
  it('defines Set Overlay Pose / Hand Pose / Hand Pin', () => {
    expect(nodeDefinition('character.setOverlayPose').label).toBe('Set Overlay Pose');
    expect(nodeDefinition('character.setHandPose').defaults({avatarId: 'a', keystroke: {code: 'KeyA', control: true, alt: false, shift: false, meta: false}})).toMatchObject({side: 'right', pose: 'open'});
    expect(nodeDefinition('character.setHandPin').settings.safeParse({entityId: 'a', side: 'left', enabled: true, mode: 'hold'}).success).toBe(true);
  });

  it('writes setAvatarAnimation through applyEffects', () => {
    const scene = makeSmokeScene();
    const graph = {
      schemaVersion: 1,
      id: 'g',
      name: 'g',
      nodes: [
        node('start', 'event.update'),
        node('pose', 'character.setOverlayPose', {
          entityId: 'performer',
          entryId: 'hotkey',
          pose: 'selfie',
          weight: 1,
        }),
      ],
      connections: [wire('1', 'start', 'flow', 'pose', 'flow')],
    };
    const compiled = compileBlueprint(graph);
    if (!compiled.ok) throw new Error(compiled.error.message);
    const run = runFlow(compiled.data, {nodeId: 'start', port: 'flow'}, emptyState(), {visits: 64, effects: 8}, 0, {...NO_ENV, scene: () => scene});
    expect(run.ok && run.data.effects).toEqual([{
      kind: 'setAvatarAnimation',
      entityId: 'performer',
      animation: {
        overlayingPoses: [{id: 'hotkey', pose: 'selfie', weight: 1, maskedBodyParts: ['leftArm', 'rightArm', 'leftFingers', 'rightFingers']}],
        overlayTransitionSeconds: 1,
        overrideHandPoses: {},
        handPin: {},
      },
    }]);
    if (!run.ok) throw new Error(run.error.message);
    const next = applyEffects(scene, run.data.effects.filter(e => e.kind === 'setAvatarAnimation' || e.kind === 'setVisibility' || e.kind === 'toggleVisibility' || e.kind === 'toggleMeshes' || e.kind === 'setMeshesVisible' || e.kind === 'selectCamera') as never);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const avatar = next.data.entities.find(e => e.kind === 'avatar' && e.id === 'performer');
    const overlay = avatar?.kind === 'avatar' ? avatar.animation?.overlayingPoses[0] : undefined;
    expect(overlay && 'pose' in overlay ? overlay.pose : undefined).toBe('selfie');
  });

  it('imports the pose hotkeys template', () => {
    const file = poseHotkeysTemplate({id: 'performer', name: 'Performer'});
    expect(BlueprintGraphSchema.safeParse(file.graph).success).toBe(true);
    expect(file.graph.nodes.filter(n => n.type === 'character.setOverlayPose')).toHaveLength(5);
    expect(file.references[0]).toEqual({id: 'performer', kind: 'avatar', name: 'Performer'});
  });
});
