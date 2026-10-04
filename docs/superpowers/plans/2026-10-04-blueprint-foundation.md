# Blueprint Foundation Implementation Plan

> **For agentic workers:** Implement each task in order. Verify each change before the next task.

**Goal:** Execute a small typed Blueprint graph through the authoritative session.

**Architecture:** Validate a versioned graph document, compile typed wires, run bounded operations, and commit one scene patch. Keep Rete as the later visual editor adapter.

**Tech Stack:** TypeScript, Zod, Vitest, existing session package.

**Spec:** [Blueprint foundation design](../specs/2026-10-04-blueprint-foundation-design.md) and [REASONS contract](../../../spdd/prompt/2026-10-04-blueprint-foundation.md).

## Global Constraints

- Maximum 128 nodes, 256 connections, 64 flow visits, and 64 patch operations per run.
- A graph cannot execute on the 60 Hz loop in this slice.
- Scene effects use the existing revision-checked `scenePatch` route.

## Review Focus

- A wire with a missing node or port fails before any effect.
- A number wired to a boolean input fails before any effect.
- A data or flow cycle fails before any effect.
- A graph with a missing required input fails before any effect.
- A Set Visibility action for a missing entity fails through `scenePatch` and leaves the scene unchanged.

### Task 1: Versioned graph contract

**Files:** Create `packages/contracts/src/blueprint.ts`; modify `packages/contracts/src/index.ts`.

- [x] Define node and connection schemas with stable IDs and six built-in node kinds.
- [x] Add contract tests for malformed settings, duplicate IDs, and size limits.
- [x] Run `pnpm test:unit`.

### Task 2: Compiler and bounded executor

**Files:** Create `packages/session/src/blueprint.ts` and `packages/session/test/blueprint.test.ts`.

- [x] Compile against a typed port table. Reject invalid wires, duplicate data inputs, missing required inputs, and cycles.
- [x] Run Manual Trigger through data evaluation to a Set Visibility operation. Bound flow visits and operations.
- [x] Test each Review Focus graph failure and a deterministic successful run.
- [x] Run `pnpm test:unit`.

### Task 3: Session command path and evidence

**Files:** Modify `packages/session/src/session.ts` and `packages/session/test/session.test.ts`; update `docs/warudo-parity.md`.

- [x] Add `runBlueprint(graph, triggerId)` to the session interface. Compile and execute, then call `applyPatch` once for all effects.
- [x] Test a valid visibility change and failed scene reference with no scene mutation.
- [x] Run `pnpm check` and `pnpm test:unit`.
- [x] Record BP-01 as partial with exact tested scope and keep BP-02 planned.
- [ ] Commit the spec, code, tests, and parity update together.
