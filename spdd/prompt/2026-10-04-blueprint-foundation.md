# REASONS: Blueprint foundation

Date: 2026-10-04. Scope: BP-01 foundation on macOS.

## R — Requirements

R1. Define a versioned, JSON-safe graph independent of Rete and Svelte.
R2. Support typed flow, number, and boolean ports. The first nodes are Manual Trigger, Number, Boolean, Add, Greater Than, and Set Visibility.
R3. Reject unknown nodes, missing references or inputs, type mismatches, duplicate input wires, duplicate IDs, and immediate cycles before execution.
R4. Execute only when explicitly triggered. Limit graph size and work per run. Return scene edits through the existing `scenePatch` path.
R5. Keep the visual editor and graph save/load for BP-02 and BP-04. Rete.js is the selected canvas library for BP-02.

## E — Entities

`BlueprintGraph` has `schemaVersion: 1`, an ID, a name, nodes, and connections. Node settings are typed by node kind. A connection names source and target node and port IDs. A compiled graph has validated wire indexes. A run produces a bounded list of scene patch operations.

## A — Approach

Validate the document with Zod, then validate port semantics and acyclicity. Keep the compiler and executor in the session package. The executor evaluates data dependencies for each flow effect and produces operations. The session applies them as one patch at the current revision. No graph code uses `eval`, the DOM, or Tauri.

Rete is an editor adapter. Its Svelte 5 plugin can render the later canvas, but Rete objects are not the saved format or authority for effects.

## S — Structure

`packages/contracts/src/blueprint.ts` owns the saved format and node kinds. `packages/session/src/blueprint.ts` owns compile and execute. `packages/session/src/session.ts` joins execution to `scenePatch`. Unit tests cover malformed graphs, cycles, deterministic execution, and command validation.

## O — Operations

1. Add the versioned graph schema and types.
2. Add compiler checks for ports, references, required inputs, and cycles.
3. Add bounded execution for the five built-in nodes.
4. Add a session method that commits effects through `applyPatch`.
5. Update the parity checklist and evidence after focused tests.

## N — Norms

Use functional TypeScript and pnpm. Keep the session independent of Svelte. Give each new behavior a meaningful unit test. Keep error messages short and include relevant graph node IDs. Write no UI copy in this slice.

## S — Safeguards

Graph limits: 128 nodes and 256 connections. A run may visit at most 64 flow nodes and produce at most 64 patch operations. Reject all immediate cycles, including data-only cycles. Do not add continuous graph execution to the 60 Hz scene loop in this slice. Do not expose guest JavaScript, native commands, or mutable scene objects to graphs.
