import { clearNodeState, getNodeState, setNodeState, type EvaluatorTable } from './types';
import './requests';

export const FLOW_EVALUATORS = {
 'flow.branch': { flow: (_node, c) => c.follow(c.read('condition') ? 'true' : 'false') },
 'flow.sequence': { flow: (node, c) => c.follow(...Array.from({ length: node.settings.outputs }, (_, i) => `then${i}`)) },
 'flow.flipFlop': {
  data: (node, _output, _read, state) => state.flip.get(node.id) ?? false,
  flow: (node, c) => { const isA = !(c.state.flip.get(node.id) ?? false); c.state.flip.set(node.id, isA); c.follow(isA ? 'a' : 'b'); },
 },
 'flow.delay': { flow: (node, c) => c.delay(node.settings.seconds) },
 'flow.gate': { flow: (node, c) => {
  const open = c.state.gates.get(node.id) ?? node.settings.startOpen;
  if (c.port === 'enter') { if (open) c.follow('exit'); return; }
  c.state.gates.set(node.id, c.port === 'open' ? true : c.port === 'close' ? false : !open);
 } },
 'flow.multiGate': { flow: (node, c) => {
  if (c.port === 'reset') { c.state.multi.delete(node.id); return; }
  const next = c.state.multi.get(node.id) ?? 0;
  if (next < node.settings.outputs) { c.state.multi.set(node.id, next + 1); c.follow(`out${next}`); return; }
  if (!node.settings.loop) return;
  c.state.multi.set(node.id, 1); c.follow('out0');
 } },
 'flow.throttle': { flow: (node, c) => {
  const last = c.state.throttle.get(node.id);
  if (last !== undefined && c.nowMs - last < node.settings.seconds * 1000) return;
  c.state.throttle.set(node.id, c.nowMs); c.follow('exit');
 } },
 'flow.forLoop': {
  data: (node, _output, _read, state) => state.loops.get(node.id) ?? 0,
  flow: (_node, c) => c.loop(Math.round(Number(c.read('first'))), Math.round(Number(c.read('last')))),
 },
 'flow.switch': { flow: (node, c) => {
  const index = node.settings.cases.indexOf(Math.round(Number(c.read('value'))));
  c.follow(index < 0 ? 'default' : `case${index}`);
 } },
 'flow.doOnce': { flow: (node, c) => {
  if (c.port === 'reset') { clearNodeState(c.state, node.id); return; }
  if (getNodeState<boolean>(c.state, node.id)) return;
  setNodeState(c.state, node.id, true); c.follow('exit');
 } },
 // The runtime replaces the pending delay of the node; the delay continues at `exit`.
 'flow.debounce': { flow: (node, c) => c.request({ kind: 'debounce', seconds: node.settings.seconds }) },
 'flow.select': { data: (_node, _output, read) => read(read('condition') ? 'ifTrue' : 'ifFalse') },
} satisfies Partial<EvaluatorTable>;
