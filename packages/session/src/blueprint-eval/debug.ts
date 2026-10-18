import type { EvaluatorTable } from './types';

// Debug Value is a pass-through; `runFlow` records what it reads (slice F R3).
export const DEBUG_EVALUATORS = {
 'debug.log': { flow: (node, c) => c.emit({ kind: 'debugLog', nodeId: node.id, level: node.settings.level, message: String(c.read('message')) }) },
 'debug.toast': { flow: (node, c) => c.emit({ kind: 'debugToast', nodeId: node.id, variant: node.settings.variant, header: String(c.read('header')), caption: String(c.read('caption')), durationSeconds: node.settings.durationSeconds }) },
 'debug.value': { data: (_n, _o, read) => read('value') },
 'debug.event': { flow: (node, c) => {
  const type = node.settings.payloadType;
  c.emit({ kind: 'debugEvent', nodeId: node.id, name: String(c.read('name')), ...(type === 'none' ? {} : { payloadType: type, payload: c.read('payload') }) });
 } },
} satisfies Partial<EvaluatorTable>;
