import { expect, it } from 'vitest';
import { BlueprintInspectSchema, InputUpdateSchema, ResultSchemas } from '../src';

it('accepts held keys alone, events alone, or both, but not an empty update', () => {
 expect(InputUpdateSchema.safeParse({ held: ['KeyW', 'KeyA'] }).success).toBe(true);
 expect(InputUpdateSchema.safeParse({ events: [{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }] }).success).toBe(true);
 expect(InputUpdateSchema.safeParse({ events: [{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }], held: ['KeyW'] }).success).toBe(true);
 expect(InputUpdateSchema.safeParse({}).success).toBe(false);
 expect(InputUpdateSchema.safeParse({ held: [] }).success).toBe(false);
 expect(InputUpdateSchema.safeParse({ held: ['ShiftLeft'] }).success).toBe(false);
 expect(InputUpdateSchema.safeParse({ held: Array(17).fill('KeyW') }).success).toBe(false);
});

it('carries the watched key set in Blueprint results only when it is not empty', () => {
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [] }).success).toBe(true);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], heldKeys: ['KeyW'] }).success).toBe(true);
 expect(ResultSchemas.blueprintEdit.safeParse({ revision: 1, keystrokes: [], heldKeys: [] }).success).toBe(false);
 expect(BlueprintInspectSchema.safeParse({ kind: 'snapshot', revision: 1, blueprints: [], errors: [], keystrokes: [], heldKeys: ['KeyS'] }).success).toBe(true);
});
