# REASONS: Rete Blueprint editor slice

Date: 2026-10-04. Scope: BP-01 and BP-02 partial.

## R — Requirements

R1. Add an edit-capability `blueprintRun` command with a versioned graph and explicit Manual Trigger ID. Route it to the authoritative session worker.
R2. Add a Rete.js canvas to the editor. Users can add the six built-in node kinds, drag nodes, connect typed ports, edit basic values and target entity, and run the draft graph.
R3. Validate the graph before the command. Show concise error feedback and prevent runs when edit capability or session connection is unavailable.
R4. Keep the draft in memory. Do not present it as a saved show graph. Persisted graph management is a later slice.

## E — Entities

The editor owns one draft `BlueprintGraph`. Rete node and connection objects are temporary views of that document. `BlueprintRunParams` contains graph and trigger node ID. The command result contains the scene revision.

## A — Approach

Add the command to TypeScript and Rust validation and routing. Keep execution in the session worker. Use `rete`, `rete-area-plugin`, `rete-connection-plugin`, and `rete-svelte-plugin/5` on the client only. Translate canvas changes to the versioned graph document. Use an editor rail button for Blueprints and a slim node palette next to the canvas.

## S — Structure

Contracts, worker, Rust bridge, MCP mapping, `apps/desktop/src/blueprints/rete-editor.ts`, `apps/desktop/src/components/BlueprintPanel.svelte`, and editor shell.

## O — Operations

1. Add and verify the common `blueprintRun` route.
2. Pin Rete dependencies and build a canvas adapter with typed sockets.
3. Add the editor panel and run controls.
4. Check TypeScript, Rust, unit and integration tests, and the running UI.
5. Update BP-01/BP-02 evidence and linked GitHub issues.

## N — Norms

Use the existing shared UI kit for editor controls. Match the current restrained editor style. Do not add a second scene authority. Use pnpm and exact dependency versions.

## S — Safeguards

`blueprintRun` requires edit capability. The Rust service rejects oversized or invalid envelopes before forwarding. The worker validates the graph and returns a typed failure. Rete runs in the editor WebView, not the session worker. A bad draft must not mutate the scene.
