# Environment import gaps analysis

Issue: [#147](https://github.com/danirukun/opensekai/issues/147) (ENV-01 slice 1). Queue bundle B23. Mode: normal. Contract under audit: [environment import](../prompt/2026-10-13-environment-import.md) (R1–R26).

## Problem

The slice 1 code merged in #150, and a macOS check passed ([check](../../docs/evaluation/environment-import.md)). The issue stays open. Its acceptance criteria ask for automated coverage that the merge did not give, and the check lists limits. This bundle closes the gaps that a Linux cloud run can close. It lists the gaps that only the owner can close on macOS.

## Audit

Each requirement R1–R26 was compared with the code and the tests on `main` at `86686e0`. The code agrees with each requirement, with one exception (R6 on macOS, below). The gaps are missing tests:

1. **Importer output and the renderer (issue acceptance item 2).** The integration test imports a generated multi-file folder and reads it through `GET /assets/{id}`. No test gives the served GLB to the renderer `inspectContainer` or to `GLTFLoader`. So nothing proves that the TypeScript side accepts what the Rust side writes.
2. **R6.** On macOS the dialog has no file-type filter (the project-wide rfd workaround). `pack_scene` rejects other extensions instead. No test covers that rejection. The window-label check already has a test (`editor_commands_and_owner_commands_reject_other_window_labels`).
3. **R7 and R9.** No test for a zip without a root, or with the root two folders down. No test proves that an entry that the root does not refer to is not read.
4. **R12.** The packer tests use a JSON fixture without meshes or materials. No test packs a real file.
5. **R14 and R15.** No test for a library file whose length is not the record `bytes`, for a title of exactly 128 code units, or that the source files do not change.
6. **R16.** No renderer test for an environment with `visible: false`.
7. **R20 and R24.** The disabled Add › Environment item and the Render Environment revert on failure are inline Svelte expressions without tests. Operation 6 of the contract asks for a disabled-item test.
8. **R22.** No test for the scene import error with the `Could not import model` fallback and the 160-character cut.
9. **R26.** No Save As and Open round trip with an environment that has an unknown `assetId` and a camera with `renderEnvironment: false`.

## Decisions

- R6 keeps the macOS exception. The contract text changes to say what the code does, because the code follows a project-wide workaround that the owner accepted in #150. Alternative: add the filter on macOS again. That needs the rfd fix and a macOS check.
- The served GLB from the integration test becomes a committed fixture, `fixtures/scene-import/packed-room.glb` (616 bytes). The Rust test fails when the packer output changes, and `OPENSEKAI_UPDATE_FIXTURES=1` writes it again. A renderer test reads the same file. Alternative: let the Rust test write a temporary file for a later TypeScript run. That makes the TypeScript test depend on the order of the two runners.
- The two editor rules move to plain functions (`addLimitReached`, `settleCheckbox`). The behavior does not change.

## Out of scope

The macOS, OBS, WebKit memory, and release build checks. The WebGL 2 fallback in a real browser. Anything in the issue "Out of scope" list.
