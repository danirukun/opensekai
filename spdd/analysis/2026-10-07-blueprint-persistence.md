# Blueprint persistence analysis

Date: 2026-10-07. Scope: the next BP-01/BP-02 slice, with a narrow BP-03 path.

## Problem

The editor holds one `BlueprintGraph` draft in Svelte memory. It survives a panel switch but disappears when the app closes. The session starts from an empty scene or the smoke fixture on each launch. There is no saved show format or load path. Users cannot keep a graph with the scene that gives its entity IDs meaning.

Warudo stores assets and blueprints in one scene document. Its editor lists the scene's blueprints and can select, duplicate, rename, group, import, and export them. OpenSekai's current graph document is already plain, versioned JSON. Rete objects are temporary editor views and do not need to be serialized.

## Existing boundaries

- `SceneView` is the validated persistent scene state in the session worker. Its `revision` changes with accepted edits. Runtime frames carry an evaluated copy.
- `BlueprintGraph` has a schema version, stable graph and node IDs, settings, node positions, and typed connections. `compileBlueprint` validates execution before `blueprintRun` changes the scene.
- The editor talks to the session through a validated operator API. Tauri owns local file access and an app-local data directory. There is no save or load command today.
- The current Blueprint panel creates a default three-node draft and stores it only in `EditorApp` memory.

## Candidate directions

1. **Versioned show document:** Save one document with the scene and an array of graphs. Load both into the authoritative session. This matches the intended scene ownership and Warudo's model. It requires an explicit scene replacement boundary, file validation, and a careful startup sequence.
2. **Standalone graph files:** Add native save/load for `BlueprintGraph` first. This is smaller, but graph entity IDs can point at the wrong scene. A later show format must reconcile two save workflows.
3. **WebView local storage:** Keep draft JSON per app install. This is the shortest implementation. It does not provide a portable show, native atomic writes, or a useful recovery boundary, and it can diverge from the authoritative scene.

The proposed direction is 1. The first slice can contain one named show and one graph, with explicit Save and Open actions. It need not add automatic execution, a full graph manager, or Warudo's clipboard and grouping controls. Those remain separate checklist work.

## Acceptance and risks

The critical path is: add an entity, edit a graph that targets it, save the show, close and reopen the app, open the show, and run the graph against the restored entity. Reject invalid files without replacing the current scene. Save atomically so a failed write keeps the prior file. Keep asset records as references to the existing managed library; a missing asset must remain a repairable reference. A loaded graph must pass its document schema, and execution must still pass the runtime compiler.

The main design risk is session replacement while the output renderer and editor are connected. A show load must publish a new authoritative snapshot, reset or advance revision in a defined way, and keep both clients in sync. A second risk is graph edits racing with scene edits. The slice needs a clear save revision and conflict rule instead of serializing whatever the editor last rendered.
