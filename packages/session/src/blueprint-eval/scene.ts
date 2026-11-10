import { withTransition } from '../tweens';
import type { EvaluatorTable } from './types';

export const SCENE_EVALUATORS = {
 'scene.setVisibility': { flow: (node, c) => c.emit({ kind: 'setVisibility', entityId: node.settings.entityId, visible: Boolean(c.read('visible')) }) },
 'scene.toggleVisibility': { flow: (node, c) => c.emit({ kind: 'toggleVisibility', entityId: node.settings.entityId }) },
 'camera.switch': { flow: (node, c) => c.emit({ kind: 'selectCamera', outputId: node.settings.outputId, cameraId: node.settings.cameraId }) },
 'camera.orbitCharacter': { flow: (node, c) => c.emit({ kind: 'orbitCamera', cameraId: node.settings.cameraId, target: { yawDegrees: c.read('yaw') as number, pitchDegrees: c.read('pitch') as number, distance: c.read('distance') as number }, ...withTransition(node.settings), nodeId: node.id }) },
} satisfies Partial<EvaluatorTable>;
