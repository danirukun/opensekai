# Rete Blueprint Editor Implementation Plan

> **For agentic workers:** Implement tasks in order and verify each boundary before continuing.

**Goal:** Edit and run a small Blueprint graph through a Rete canvas.

**Architecture:** Rete edits a versioned draft document. The common command bridge forwards a validated run to the session worker.

**Tech Stack:** Svelte 5, Rete 2, TypeScript, Rust, Vitest, Cargo.

**Spec:** [Rete Blueprint editor design](../specs/2026-10-04-rete-blueprint-editor-design.md) and [REASONS contract](../../../spdd/prompt/2026-10-04-blueprint-editor.md).

## Global Constraints

- Draft graph only; show persistence is outside this slice.
- `blueprintRun` requires edit capability.
- Graph execution stays in the session worker.

## Review Focus

- Read-only operator cannot run a graph.
- Bad node and port data fail before scene mutation.
- Disconnected session produces an error in the panel.
- Selecting a missing scene target leaves the scene unchanged.
- Repeated panel mount and unmount releases Rete listeners.

### Task 1: Command route

**Files:** TypeScript contract and worker; Rust contract and router; MCP mapping.

- [x] Add validated `blueprintRun` params and result.
- [x] Relay it to the publisher under edit capability.
- [x] Add contract and loopback route tests.

### Task 2: Rete canvas

**Files:** Desktop dependency manifest, lockfile, Rete adapter, Blueprint panel, editor shell and styles.

- [x] Pin compatible Rete packages.
- [x] Render typed sockets and translate node and connection changes to a graph draft.
- [x] Support adding nodes, editing values and target, and invoking Manual Trigger through the shared command.
- [x] Verify the canvas UI in the local browser and capture the running Tauri editor window.

### Task 3: Evidence and checkpoint

**Files:** Parity checklist, evidence, GitHub issues.

- [x] Run focused and workspace checks.
- [x] Record exact BP-01/BP-02 partial scope.
- [ ] Commit and push the checkpoint, then update issue labels and comments.
