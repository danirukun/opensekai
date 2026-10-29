# Prop import analysis

Date: 2026-10-28. Scope: ENV-03 slice 1 (prop import, transforms, and reuse). Contract: [prop import](../prompt/2026-10-28-prop-import.md). Issue: [GitHub #41](https://github.com/danirukun/opensekai/issues/41).

## Problem

A scene can have only one environment. A stage is often more than one model. The Bonnie Warudo scene ([GitHub #240](https://github.com/danirukun/opensekai/issues/240)) has one environment (the stage) and four props: walls, ceiling, an airship, and a mascot. Each prop has its own transform. The operator cannot add those models to an OpenSekai scene.

The code already has most of the parts:

- The `mesh` entity kind has a source `{ kind: 'asset', assetId }`. The renderer loads that asset, draws a copy for each entity, puts it in the props light group, and makes it a pick target.
- The scene importer makes general `scene_<sha256>` GLB records. The environment design says that props can use the same records.
- The Hierarchy has a Props group. Duplicate copies a mesh entity. The Blueprint property registry accepts a mesh as a target.

These parts are missing:

- The Add menu has no Prop item.
- A mesh entity has no Source field in the Inspector, and no operation changes its source.
- A mesh asset source must have an asset ID, so a new prop cannot start without a model, as an environment does.
- A prop copy gets no environment map. The environment analysis found that glossy PBR surfaces without a map render almost black.

Warudo Prop (handbook, reviewed 2026-10-28): Source, Transform, Attach To (a parent asset and a bone, or a transform path), Override Hand Pose, Default BlendShapes, Default Material Properties, Meshes (a visibility switch for each mesh), and Collision Detection.

## Decisions

- Slice 1 is import, transforms, and reuse. The operator accepted this scope on 2026-10-28. Attach To and Override Hand Pose are slice 2. BlendShapes, material properties, mesh switches, and collision are later.
- A prop is the existing `mesh` entity. The UI calls it Prop. A rename of the kind would change every show for no user effect.
- A new prop starts with no model. The mesh asset source gets a nullable asset ID, and the operation `setMeshModel` sets it. This is the same pattern as `setEnvironmentModel` and `setAvatarModel`.
- Props use the same library records as the environment. One import serves any number of props and the environment. The import dialog title becomes `Import model`.
- Props get the neutral room map, as the environment does. Their reflections use the Reflections Intensity of the scene environment, because in Warudo that setting applies to the whole scene. This changes R17 of the environment contract, which gave the map to the environment only.
- Props stay in the props light group, so Affect Props and Affect Environment keep their separate meanings.
- There is no prop count limit. The 64-entity scene limit applies.

## Effects

- Old shows open without change. A show with a prop that has no model does not open in an older build.
- A mesh with a `box` source draws as before. Its Inspector shows only the Transform, because the box is a fixture shape and not a library model.
- Each prop is a copy of a cached asset. Geometry and textures load once for each renderer client. Each copy has its own lit materials, because each light group has its own node set.

## Risks

- Many large props can exceed the WebKit memory limit. The live check uses the Bonnie stage props (about 23 MB of GLB).
- A prop from a Unity export can have a root offset. The operator uses the transform. The slice does not add automatic fit.

## Out of scope

Attach To, Override Hand Pose, BlendShapes, material properties, mesh switches, collision, MCP import, drag and drop, and Warudo `.warudo` prop import (ENV-12).
