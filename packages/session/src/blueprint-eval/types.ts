import { blueprintValueProblem, isBlueprintValue, type AvatarPose, type BlueprintKind, type BlueprintNodeOf, type BlueprintValue, type DataType, type Id, type SceneView } from '@opensekai/contracts';
import type { BlueprintEffect } from '../blueprint';

export type { BlueprintValue } from '@opensekai/contracts';
// Per-run inputs from outside the graph.
// `scene` is read on demand, so a run sees the writes of earlier runs in the same tick.
// `previousPose` is the avatar pose of the previous tick, before expressions and bone offsets.
export interface RunEnv { deltaSeconds: number; held: ReadonlySet<string>; scene: () => SceneView | null; previousPose?: (avatarId: Id) => AvatarPose | null }
export const NO_ENV: RunEnv = { deltaSeconds: 0, held: new Set(), scene: () => null };
// Plain data that a stateful node keeps between runs. A node replaces its entry and never changes a stored object,
// because a run copy shares the stored objects with the committed state.
export type NodeState = BlueprintValue | null | readonly NodeState[] | { readonly [key: string]: NodeState };
// `nodes` is the state of node types added after the catalog slice; the other maps belong to the catalog node types.
export interface RunState { variables: Map<Id, BlueprintValue>; flip: Map<Id, boolean>; gates: Map<Id, boolean>; multi: Map<Id, number>; throttle: Map<Id, number>; loops: Map<Id, number>; nodes: Map<Id, NodeState>; random: number }
export const emptyState = (seed = 0): RunState => ({ variables: new Map(), flip: new Map(), gates: new Map(), multi: new Map(), throttle: new Map(), loops: new Map(), nodes: new Map(), random: seed });
export const cloneState = (s: RunState): RunState => ({ variables: new Map(s.variables), flip: new Map(s.flip), gates: new Map(s.gates), multi: new Map(s.multi), throttle: new Map(s.throttle), loops: new Map(s.loops), nodes: new Map(s.nodes), random: s.random });
export const getNodeState = <T extends NodeState>(state: RunState, nodeId: Id): T | undefined => state.nodes.get(nodeId) as T | undefined;
export const setNodeState = (state: RunState, nodeId: Id, value: NodeState): void => { state.nodes.set(nodeId, value); };
export const clearNodeState = (state: RunState, nodeId: Id): void => { state.nodes.delete(nodeId); };

export class BlueprintLimitError extends RangeError {}
// Throws when a value does not fit its type, so the run fails and its state is not kept.
export function checkBlueprintValue(type: DataType, value: unknown): void {
 if (isBlueprintValue(type, value)) return;
 const problem = blueprintValueProblem(type, value);
 if (problem === 'limit') throw new BlueprintLimitError('Blueprint value exceeds its limit');
 if (problem === 'type') throw new RangeError('Blueprint value does not match its type');
}

export interface FlowContext {
 // The flow input that this visit entered.
 port: string;
 read(port: string): BlueprintValue;
 follow(...ports: string[]): void;
 // Records the effect and continues at `exit`.
 emit(effect: BlueprintEffect): void;
 delay(seconds: number): void;
 // Runs `body` once per index from first to last, then `completed`.
 loop(first: number, last: number): void;
 state: RunState;
 nowMs: number;
 env: RunEnv;
}
export type Read = (port: string) => BlueprintValue;
export interface Evaluator<N> {
 data?(node: N, output: string, read: Read, state: RunState, env: RunEnv): BlueprintValue;
 flow?(node: N, context: FlowContext): void;
}
export type EvaluatorTable = { [K in BlueprintKind]: Evaluator<BlueprintNodeOf<K>> };
