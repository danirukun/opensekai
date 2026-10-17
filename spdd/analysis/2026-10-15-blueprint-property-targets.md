# Blueprint property targets analysis

Date: 2026-10-15. Scope: bundle B3 (#153, the first part of #85). Follows the [continuous Blueprints](../prompt/2026-10-12-continuous-blueprints.md) slice (R3 to R5, R10 to R12) and the [environment import](2026-10-13-environment-import.md) slice.

## Problem

1. **Environment target (#153).** A Blueprint can refer to the environment entity, but `propertiesFor('environment')` returns no properties. Get Asset Property, Set Asset Property, and Move Entity reject the environment. A Blueprint cannot hide the stage or move it on a trigger, although the entity has `visible` and a transform. The session already applies `setTransform` and `setVisibility` to an environment.
2. **More keys (#85, first part).** The registry has five keys. The camera has one more scalar setting that the editor can change and that has a patch operation: Render Environment (`renderEnvironment`, `setCameraRenderEnvironment`). A Blueprint cannot switch it. In Warudo, a Blueprint can set each camera property with Set Asset Property.

## Decisions

- Add `environment` to the placed kinds. The environment gets Position, Rotation, Scale, and Visible. Move Entity also accepts the environment, because it writes Position.
- Add the key `renderEnvironment` (label Render Environment, boolean, camera only). A camera without the field reads `true`, the same default as the renderer and the Inspector.
- An idle override of `renderEnvironment` commits as `setCameraRenderEnvironment`. A `setCameraRenderEnvironment` patch drops that override.
- Rust has no property list. Blueprint settings are validated in TypeScript only. So no Rust change.
- Do not add the camera clip planes (`near`, `far`). Their rule depends on the other value (`near < far`), and the registry has one rule for each key. A later slice can add a cross-field rule.
- Do not add avatar keys (tracking, idle animation, model). Their values are not number, boolean, or Vector3.

## Effects

- The property select of the Blueprint editor lists four entries for an environment and six for a camera.
- The `opensekai://blueprint-nodes` MCP resource lists the new kind and the new key, because it reads the same registry.
- Saved graphs and Blueprint files do not change shape. Old files stay valid.

## Risks

- An old OpenSekai build that opens a show with a `renderEnvironment` property node rejects the graph, because the key is not in its enum. This is the same rule as for any new node setting.

## Out of scope

Camera clip planes, tracking, character, animation, and the other BP-05 operations.
