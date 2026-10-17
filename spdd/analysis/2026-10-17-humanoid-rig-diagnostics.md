# Humanoid rig diagnostics analysis

Date: 2026-10-17. Scope: the CHR-01 humanoid rig validation part ([GitHub #7](https://github.com/danirukun/opensekai/issues/7)). Bundle B4.

## Problem

The avatar importer already rejects a VRM with an invalid humanoid. The checks are in `validate_import_file` (`apps/desktop/src-tauri/src/assets/registry.rs`): required bones, the VRM 0.x `chest` bone, duplicate bone names, duplicate nodes, unknown bone names, and node indexes out of range. Each failure gives one of two generic messages: "Missing or duplicate VRM humanoid bone" or "Invalid VRM humanoid". The operator cannot see which bone fails, so the operator cannot repair the model in a VRM tool.

Warudo imports VRM models through its character asset ([Character](https://docs.warudo.app/docs/assets/character)). The handbook page was not reachable from the cloud container on 2026-10-17 (DNS failure). The owner must recheck it at local acceptance.

## Decisions

- Keep the current rules. Do not reject a model that the importer accepts now.
- Each rule gives its own message and names the failing bones. The message lists at most 8 names, then "and N more". `AppError.ids` holds every name.
- The check order is: unknown bone names, duplicate bone names, missing required bones, bones without a valid node, bones that share one node. The first failing rule gives the error.
- Move the humanoid check and the VRM expression list into a new module `assets/vrm.rs`. The registry calls it.
- The Inspector shows the import error message as it does now. No new UI.

## Rejected approaches

- Hierarchy checks (for example, `leftLowerArm` must be a descendant of `leftUpperArm`). They can reject models that import now, and three-vrm does not require them. Record it as a remaining gap.
- Warnings stored on the asset record. That changes the record shape for no current consumer.

## Effects

- Library records do not change. The rules do not change, so a stored model stays valid.
- MCP has no import tool, so only the Editor import shows the new messages.

## Out of scope

Bone hierarchy checks, T-pose or rest pose checks, spring bone checks, and a model report view.
