import type { EvaluatorTable } from './types';

export const SCENE_EVALUATORS = {
 'scene.setVisibility': { flow: (node, c) => c.emit({ kind: 'setVisibility', entityId: node.settings.entityId, visible: Boolean(c.read('visible')) }) },
 'scene.toggleVisibility': { flow: (node, c) => c.emit({ kind: 'toggleVisibility', entityId: node.settings.entityId }) },
 'camera.switch': { flow: (node, c) => c.emit({ kind: 'selectCamera', outputId: node.settings.outputId, cameraId: node.settings.cameraId }) },
} satisfies Partial<EvaluatorTable>;
