import { expect, it } from 'vitest';
import { NODE_DEFINITIONS } from '@opensekai/contracts';
import { EVALUATORS, emptyState, cloneState } from '../src/blueprint-eval';

it('has an evaluator for every node definition', () => {
 for (const definition of NODE_DEFINITIONS) expect(EVALUATORS[definition.type], definition.type).toBeDefined();
});

it('clones run state without sharing maps', () => {
 const state = emptyState(7);
 const copy = cloneState(state);
 copy.flip.set('ff', true); copy.variables.set('v', 1);
 expect(state.flip.size + state.variables.size).toBe(0);
 expect(copy.random).toBe(7);
});
