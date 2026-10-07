import type { BlueprintNode, KeystrokeSettings } from './blueprint';

export type PortType = 'flow' | 'number' | 'boolean';
export interface PortShape { inputs: Record<string, PortType>; outputs: Record<string, PortType> }
export type BlueprintKind = BlueprintNode['type'];

const exit = { exit: 'flow' } as const;
export function blueprintPorts(node: BlueprintNode): PortShape {
 switch (node.type) {
  case 'event.manual': case 'event.keystroke': return { inputs: {}, outputs: { flow: 'flow' } };
  case 'value.number': return { inputs: {}, outputs: { value: 'number' } };
  case 'value.boolean': return { inputs: {}, outputs: { value: 'boolean' } };
  case 'math.add': return { inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } };
  case 'logic.greater': return { inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } };
  case 'logic.not': return { inputs: { value: 'boolean' }, outputs: { result: 'boolean' } };
  case 'flow.branch': return { inputs: { flow: 'flow', condition: 'boolean' }, outputs: { true: 'flow', false: 'flow' } };
  case 'flow.sequence': return { inputs: { flow: 'flow' }, outputs: Object.fromEntries(Array.from({ length: node.settings.outputs }, (_, i) => [`then${i}`, 'flow' as const])) };
  case 'flow.flipFlop': return { inputs: { flow: 'flow' }, outputs: { a: 'flow', b: 'flow', isA: 'boolean' } };
  case 'flow.delay': return { inputs: { flow: 'flow' }, outputs: exit };
  case 'scene.setVisibility': return { inputs: { flow: 'flow', visible: 'boolean' }, outputs: exit };
  case 'scene.toggleVisibility': case 'camera.switch': return { inputs: { flow: 'flow' }, outputs: exit };
 }
}

export const BLUEPRINT_LABELS: Record<BlueprintKind, string> = {
 'event.manual': 'Manual Trigger', 'event.keystroke': 'On Keystroke Pressed',
 'value.number': 'Number', 'value.boolean': 'Boolean', 'math.add': 'Add', 'logic.greater': 'Greater Than', 'logic.not': 'Not',
 'flow.branch': 'If Branch', 'flow.sequence': 'Sequence', 'flow.flipFlop': 'Flip Flop', 'flow.delay': 'Delay',
 'scene.setVisibility': 'Set Visibility', 'scene.toggleVisibility': 'Toggle Visibility', 'camera.switch': 'Switch Camera',
};

export function defaultBlueprintSettings(kind: BlueprintKind, refs: { entityId: string; cameraId: string; keystroke: KeystrokeSettings }): BlueprintNode['settings'] {
 switch (kind) {
  case 'event.keystroke': return { ...refs.keystroke };
  case 'value.number': return { value: 0 };
  case 'value.boolean': return { value: true };
  case 'flow.sequence': return { outputs: 2 };
  case 'flow.delay': return { seconds: 1 };
  case 'scene.setVisibility': case 'scene.toggleVisibility': return { entityId: refs.entityId };
  case 'camera.switch': return { outputId: 'output_main', cameraId: refs.cameraId };
  default: return {};
 }
}
