# Character model analysis

Date: 2026-10-09. Scope: characters as normal scene assets.

## Problem

The Assets panel has two controls. **Add** creates cameras and tracking sources. **Import** opens a VRM file picker and creates an avatar in one step. A character is therefore not an asset like the others: the operator cannot add a character first and choose its model later, and cannot replace the model of an existing character. A show that refers to a missing model can open, but the operator cannot repair the reference in the editor.

Warudo uses one flow. The operator adds a Character asset, and the Inspector has a source field that selects the model. The operator asked for this flow.

## Decisions

- An avatar entity can exist without a model. `assetId` becomes `Id | null`. The key stays required, as with `bodySourceId`.
- **Add › Character** creates a character with no model. The separate Import button is removed.
- The Inspector shows a **Model** row for a character. It opens the existing native VRM picker. The selected file goes into the asset library, and a new scene operation, `setAvatarModel`, sets the character's model. A second selection replaces the model.
- An asset record stores the model's display `name`. The importer reads it from VRM meta (`VRMC_vrm.meta.name`, then `VRM.meta.title`) and uses the file stem when the meta has no name. Records in the library that have no name get one when the library loads, from the VRM meta of the stored `.vrm` file, then `Avatar`.
- A character with no model renders nothing. The output has no placeholder.
- MCP gets `setAvatarModel` through `scene_patch`, because MCP uses the validated command API. MCP can set only an asset ID; it cannot import a file.

## Model loading

The renderer loads a model inside frame submission, and submissions run in sequence. While a model loads, the preview and the OBS output stop. With the Rem VRM, the stop is 1 to 2 s with a warm pipeline cache and 10.9 s with a cold cache in Safari ([avatar performance](../../docs/evaluation/avatar-performance.md)). The operator sees no status during this time.

- The renderer loads models in the background. The rest of the scene continues to render. A replaced model stays visible until the new model is ready.
- The renderer prepares GPU pipelines for the new model before it joins the scene, to move pipeline compilation out of the frame path. A Safari measurement must confirm this.
- The Scene window shows a centered overlay card with the model name, the stage, and a progress bar. The stages are download, textures, prepare, and failed. Shader preparation has no known total, so its bar is indeterminate.
- The editor shows the same status in the Model row, and a spinner in the character's Assets row. The native import step shows its own indeterminate state.
- The overlay is outside the canvas. The OBS output and captures stay clean.

## Effects

- Shows that refer to an asset ID still open without change. A show can now hold a character with `assetId: null`. Older builds reject such a show.
- The avatar budget (two) counts characters with no model.
- A missing model reference stays repairable: the operator selects a new file in the Model row.
- The session continues to evaluate idle and tracking poses for a character with no model. The renderer ignores them.

## Out of scope

Model selection from the existing library without the file picker, import progress percent from the native host, load status for the OBS output in the editor, model thumbnails, automatic rename of a character to its model name, and import of GLB props.
