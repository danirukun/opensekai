# REASONS: Extension sandbox gate

Date: 2026-10-16. Scope: bundle B10 (#98, #106). Analysis: [extension sandbox gate](../analysis/2026-10-16-extension-sandbox-gate.md). Parent: [foundation](2026-10-02-opensekai-foundation.md) R8 and O7.

## R — Requirements

R1. `ExtensionManifestSchema` accepts `{ manifestVersion: 1, id, name, version, apiVersion: 1, capabilities }`. `id` is reverse DNS in lowercase. `capabilities` is a set from `log`, `nodes`, `assetTypes`. Any other shape is rejected before guest code runs.
R2. `createSandbox(options)` loads each extension into its own QuickJS WASM instance with a memory limit, a stack limit, and a deadline for each guest entry.
R3. The guest global scope has no host bridge, no binary buffer types, and no DOM, network, timer, file, or Tauri global. `opensekai` is frozen and has `apiVersion`, `log`, `registerNode`, and `registerAssetType`.
R4. `registerNode({ type, label, inputs, outputs, evaluate })` needs `nodes`. Ports are `number`, `boolean`, or `vector3`; a node has 0 to 16 inputs and 1 to 16 outputs. The catalog type is `<extension id>/<type>`.
R5. `registerAssetType({ kind, label, fileExtensions })` needs `assetTypes`. A file extension that a built-in importer or the show file owns (`.vrm`, `.glb`, `.gltf`, `.zip`, `.osekai`, `.json`), or that another extension owns, is rejected.
R6. Registration is allowed only while the extension loads. `log` needs `log`.
R7. `evaluate(type, inputs)` validates the inputs against the declared ports and rejects bad inputs without a fault. It copies the inputs into the guest and the outputs back as JSON. The outputs must have exactly the declared ports with finite numbers.
R8. A fault disables the extension: denied capability, invalid registration, invalid output, quota (logs per call, log size, result size, node count, asset type count), time limit, memory limit, stack overflow, or uncaught error. A bridge fault wins when the guest catches the error. The host releases the registrations, the handles, the context, and the runtime, calls `onFailure`, and keeps other extensions running.
R9. A WASM trap, or a QuickJS error without a value, is an `error` fault for that extension only. The host does not call `computeMemoryUsage` on a guest runtime.
R10. A failed extension can load again. `unload` and `dispose` release every QuickJS handle (no QuickJS abort).
R11. The worker protocol carries only plain data. The worker runs requests in arrival order.
R12. The client watchdog terminates a worker that sends no message for `watchdogMs` while a request waits (plus `startupMs` before a new worker sends its first message). It disables the extension of the oldest waiting request with `unresponsive` (not for an unload), starts a new worker, loads the other extensions again, and sends the other waiting requests again. The owner of each request is recorded when it is sent. `close` stops all events and answers waiting requests with `closed`.
R13. `load` reserves the extension ID before it awaits the WASM instance, so two loads of one ID cannot both succeed. A host `onLog` or `onFailure` error does not change a result.

## E — Entities

- `ExtensionManifest`, `Capability`, `SandboxLimits` (`DEFAULT_LIMITS`).
- `ExtensionNodeDefinition { extensionId, type, label, inputs, outputs }`, `ExtensionAssetType { extensionId, kind, label, fileExtensions }`.
- `FailureCause { code: timeout | memory | stack | denied | quota | invalid | error | unresponsive, message }`, `RejectCause { code: manifest | duplicate | unknown-node | input | closed, message }`.
- `ExtensionStatus`: `ready`, or `failed` with a cause.
- `WorkerRequest`, `WorkerReply`, `WorkerEvent` (`failed`, `log`).

## A — Approach

Probe QuickJS limits first. Build the sandbox host with a trusted prelude and a string-only bridge. Add the worker protocol and the client watchdog. Measure each limit and record the gaps as findings, not as passed gates.

## S — Structure

- `packages/extensions/src/manifest.ts`, `sandbox.ts`, `worker.ts`, `client.ts`, `index.ts`.
- `packages/extensions/test/sandbox.test.ts`, `client.test.ts`, `worker.integration.test.ts`, `fixtures/worker-entry.ts`, `fixtures/worker-boot.mjs`.
- `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/evaluation/extension-sandbox.md`, the architecture design decision table.

## O — Operations

1. Manifest and port schemas with zod.
2. Sandbox: one WASM instance per load, limits, interrupt deadline, prelude, bridge with capability checks, guarded entries, release on fault.
3. Worker: ordered queue; `installExtensionWorker` for a dedicated worker scope.
4. Client: request ids, watchdog on worker silence, recovery and reload.
5. Tests: unit tests for each requirement with the real QuickJS VM; a client unit test with a fake thread boundary; an integration test with a real Node worker thread.
6. Measure the limits and write the evidence page. Update the parity checklist and `ARCHITECTURE.md`.

## N — Norms

Write prose in ASD-STE100. Keep functional TypeScript and plain data. Do not add UI. Do not wire the package into an app process in this slice.

## S — Safeguards

- Do not pass a host object, a function, or a QuickJS handle to guest code. Only strings cross the bridge.
- Do not claim the memory gate. Do not ship guest plugins until a hard memory bound passes the gate in the analysis.
- Do not let a guest register outside its load, or claim a built-in file extension.
- Do not change the wire API, the show file, or the Blueprint file.
