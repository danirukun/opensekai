import type { BlueprintValue, Id } from '@opensekai/contracts';

// What a run asks the runtime to do after the run commits (slice D). Effects on the scene stay in the effect union.
export type RuntimeRequest =
 | { kind: 'emit'; name: string; payload: BlueprintValue | null }
 | { kind: 'control'; graphId: Id; action: 'enable' | 'disable' | 'toggle' }
 | { kind: 'startTimer'; name: string; seconds: number; repeat: boolean }
 | { kind: 'stopTimer'; name: string }
 // Replaces the pending delays of the node with one delay of `seconds`.
 | { kind: 'debounce'; seconds: number };
export type NodeRequest = RuntimeRequest & { nodeId: Id };

// FlowContext and RunEnv live in types.ts (owned by the value model slice); slice D adds its fields by declaration merging.
declare module './types' {
 interface FlowContext {
  request(request: RuntimeRequest): void;
 }
 interface RunEnv {
  // The session time of the run, in milliseconds.
  nowMs?: number;
  // The enabled flag of a graph at the start of the step; false for an unknown graph.
  graphEnabled?: (graphId: Id) => boolean;
 }
}
