import type { BlueprintKind, BlueprintNodeOf, Id } from '@opensekai/contracts';
import type { BlueprintEffect } from '../blueprint';

export type BlueprintValue = number | boolean;
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
 state: RunState;
 nowMs: number;
}
export type Read = (port: string) => BlueprintValue;
export interface Evaluator<N> {
 data?(node: N, output: string, read: Read, state: RunState): BlueprintValue;
 flow?(node: N, context: FlowContext): void;
}
export type EvaluatorTable = { [K in BlueprintKind]: Evaluator<BlueprintNodeOf<K>> };
