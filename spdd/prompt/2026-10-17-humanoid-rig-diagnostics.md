# REASONS: Humanoid rig diagnostics

Date: 2026-10-17. Scope: the CHR-01 humanoid rig validation part. Analysis: [humanoid rig diagnostics](../analysis/2026-10-17-humanoid-rig-diagnostics.md).

## R — Requirements

R1. Avatar import keeps the current humanoid rules: the 15 required bones (`hips`, `spine`, `head`, both upper legs, lower legs, feet, upper arms, lower arms, and hands), `chest` for VRM 0.x, known bone names (VRM 0.x also accepts `leftThumbIntermediate` and `rightThumbIntermediate`), one entry for each bone name, a node index inside `nodes`, and one bone for each node.
R2. A failure returns `INVALID_INPUT` with the first failing rule in this order: "Unknown VRM humanoid bones", "Duplicate VRM humanoid bones", "Missing VRM humanoid bones", "VRM humanoid bones have no valid node", "VRM humanoid bones share one node". The message is the rule text, a colon, and the sorted bone names. A list of more than 8 names shows the first 8 and "and N more". `ids` has all the sorted names. An empty VRM 0.x bone name shows as "(empty)".
R3. A document without a humanoid bone list, or with an empty list, gives "Missing VRM humanoid". A document without `nodes` gives "Missing VRM nodes".
R4. The Editor shows the message under the Model row, as for other import errors.

## E — Entities

No new entity. `AppError` carries the message and the bone names in `ids`.

## A — Approach

Move the humanoid check out of `validate_import_file` into `assets/vrm.rs` as `validate_humanoid(json, vrm0)`. Keep the same rules and give each rule its own error.

## S — Structure

`apps/desktop/src-tauri/src/assets/vrm.rs`, `assets/registry.rs`, `assets/mod.rs`.

## O — Operations

1. Add `validate_humanoid` with unit tests for each rule, the name list limit, and both VRM versions.
2. Call it from `validate_import_file`. The existing rig rejection test stays green.
3. Local acceptance: import a VRM without a `head` bone in the macOS editor and read the message.

## N — Norms

Write prose in ASD-STE100. Keep messages short.

## S — Safeguards

- Do not accept a model that the old rules reject, and do not reject a model that the old rules accept.
- Do not add UI copy beyond the error message.
