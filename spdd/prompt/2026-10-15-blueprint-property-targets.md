# REASONS: Blueprint property targets

Date: 2026-10-15. Scope: bundle B3 (#153, the first part of #85). Analysis: [Blueprint property targets](../analysis/2026-10-15-blueprint-property-targets.md). Changes the property registry of [continuous Blueprints](2026-10-12-continuous-blueprints.md) R3.

## R — Requirements

R1. The property registry lists Position, Rotation, Scale, and Visible for `mesh`, `avatar`, `camera`, and `environment`. `tracking` has no properties.
R2. The registry has the key `renderEnvironment`: label Render Environment, type boolean, rule boolean, kind `camera` only. Read gives the field value, or `true` when the field is absent. Write sets the field, except that a write of `true` to a camera without the field keeps the field absent. So that write changes nothing and commits nothing.
R3. Get Asset Property, Set Asset Property, and Move Entity work on the environment with the rules of continuous Blueprints R4, R5, R10, and R11.
R4. An idle `renderEnvironment` override commits as one `setCameraRenderEnvironment` operation. A `setCameraRenderEnvironment` patch from the editor or MCP removes the `renderEnvironment` override of that camera (continuous Blueprints R12).
R5. The editor property select and the `opensekai://blueprint-nodes` resource use the registry, so they show R1 and R2 with no other change.
R6. A unit test covers the registry for each kind and the read default. A session test runs one Blueprint that hides and shows the environment and checks the frame and the committed scene. A session test sets Render Environment and checks the commit and the patch drop.
R7. The Value field of the Boolean node (`value.boolean`) is a select with the options True and False, so the editor shows the value that the node gives. Other boolean fields (Gate Start open, Multi Gate Loop) stay checkboxes. Owner review of PR #162.

## E — Entities

- `PROPERTY_KEYS` adds `renderEnvironment`. `PropertyKey` follows.
- No change to `SceneEntity`, the patch operations, the Blueprint file format, or the Rust contracts.

## A — Approach

Change the registry data and the read and write switch. Map the new key in the session override commit and drop rules. Add tests. Check the editor flow in a headless browser where WebGL works; else record it as a local check.

## S — Structure

- `packages/contracts/src/property-registry.ts`, `packages/contracts/test/property-registry.test.ts`.
- `packages/session/src/overrides.ts`, `packages/session/test/property-nodes.test.ts`.
- `apps/desktop/src/components/BlueprintNodeFields.svelte` (R7).
- `docs/warudo-parity.md` (BP-05).

## O — Operations

1. Registry: add `environment` to the placed kinds and add `renderEnvironment`.
2. Session: commit and drop rules for `renderEnvironment`.
3. Tests: registry, environment hide and show, Move Entity on the environment, Render Environment commit and drop.
4. Update the parity checklist with the verified behavior only.

## N — Norms

Write prose in ASD-STE100. Keep functional TypeScript and plain data. Do not add UI copy.

## S — Safeguards

- Do not let a property write change the entity kind or a field that the registry does not list.
- Do not add a property to `tracking`.
- Do not claim a macOS, OBS, or renderer result from the cloud run.
