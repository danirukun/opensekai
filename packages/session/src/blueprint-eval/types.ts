import type { AvatarPose, BlueprintKind, BlueprintNodeOf, Id, SceneView, Vec3 } from '@opensekai/contracts';
import type { BlueprintEffect } from '../blueprint';

export type BlueprintValue = number | boolean | Vec3;
// Per-run inputs from outside the graph.
// `scene` is read on demand, so a run sees the writes of earlier runs in the same tick.
// `previousPose` is the avatar pose of the previous tick, before expressions and bone offsets.
export interface RunEnv { deltaSeconds: number; held: ReadonlySet<string>; scene: () => SceneView | null; previousPose?: (avatarId: Id) => AvatarPose | null }
export const NO_ENV: RunEnv = { deltaSeconds: 0, held: new Set(), scene: () => null };
export interface RunState { variables: Map<Id, BlueprintValue>; flip: Map<Id, boolean>; gates: Map<Id, boolean>; multi: Map<Id, number>; throttle: Map<Id, number>; loops: Map<Id, number>; random: number }
export const emptyState = (seed = 0): RunState => ({ variables: new Map(), flip: new Map(), gates: new Map(), multi: new Map(), throttle: new Map(), loops: new Map(), random: seed });
export const cloneState = (s: RunState): RunState => ({ variables: new Map(s.variables), flip: new Map(s.flip), gates: new Map(s.gates), multi: new Map(s.multi), throttle: new Map(s.throttle), loops: new Map(s.loops), random: s.random });

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
